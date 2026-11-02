import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  captureProcessId,
  createLearningEvidenceRepository,
  markCaptureCleanShutdown,
  openLearningEvidenceDb
} from '../data/learning-evidence';
import { recoverInterruptedEvidence, touchCapturePresence } from './recovery';
import { reqToPromise } from '../data/training-db';
afterEach(() => vi.unstubAllGlobals());
const occurred = Date.parse('2026-10-26T00:00:00Z');
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value))
  };
}
async function fixture(storage?: Storage) {
  const factory = new IDBFactory();
  vi.stubGlobal('window', { indexedDB: factory, ...(storage ? { localStorage: storage } : {}) });
  const db = await openLearningEvidenceDb(factory);
  const repo = createLearningEvidenceRepository(db, 'unclaimed');
  await repo.append([
    {
      id: 'old-open',
      kind: 'exposure-open',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-26T00:00:00Z',
      characters: ['K'],
      presentation_id: 'old',
      started_at: null,
      session_id: null,
      source: 'reference'
    }
  ]);
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  const row = await reqToPromise(store.get(['unclaimed', 'old-open']));
  await reqToPromise(store.put({ ...row, processId: 'previous-document' }));
  return { db, repo, factory };
}
describe('interrupted exposure recovery', () => {
  it("never closes another live document's action", async () => {
    const f = await fixture();
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_n: unknown, _o: unknown, fn: (lock: null) => Promise<void>) => fn(null)
      }
    });
    await recoverInterruptedEvidence('unclaimed', () => true);
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('closes an abandoned local document conservatively at recovery and once only', async () => {
    const f = await fixture();
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_n: unknown, _o: unknown, fn: (lock: object) => Promise<void>) => fn({})
      }
    });
    const before = Date.now();
    await recoverInterruptedEvidence('unclaimed', () => true);
    await recoverInterruptedEvidence('unclaimed', () => true);
    const records = await f.repo.all();
    expect(records).toHaveLength(2);
    const closed = records.find((r) => r.kind === 'exposure-close')!;
    expect(closed.end_reason).toBe('recovery');
    expect(
      Date.parse((closed.last_exposure as Record<string, { latest: string }>).K.latest)
    ).toBeGreaterThanOrEqual(before);
    f.db.close();
  });
  it('does not recover a different owner or after ownership changes', async () => {
    const f = await fixture();
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_n: unknown, _o: unknown, fn: (lock: object) => Promise<void>) => fn({})
      }
    });
    await recoverInterruptedEvidence('account:other', () => true);
    await recoverInterruptedEvidence('unclaimed', () => false);
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
});

describe('lock-free recovery', () => {
  it('closes a stale abandoned guard only after the conservative grace period', async () => {
    const f = await fixture(memoryStorage());
    vi.stubGlobal('navigator', {});
    await recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred + 30_000
    });
    expect(await f.repo.all()).toHaveLength(1);
    await recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred + 61_000
    });
    const records = await f.repo.all();
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.kind === 'exposure-close')).toMatchObject({
      end_reason: 'recovery',
      last_exposure: { K: { earliest: new Date(occurred + 61_000).toISOString() } }
    });
    f.db.close();
  });
  it('serializes concurrent lock-free recoveries to one immutable closure', async () => {
    const f = await fixture(memoryStorage());
    const now = occurred + 61_000;
    vi.stubGlobal('navigator', {});
    await Promise.all([
      recoverInterruptedEvidence('unclaimed', () => true, { now: () => now }),
      recoverInterruptedEvidence('unclaimed', () => true, { now: () => now })
    ]);
    expect((await f.repo.all()).filter((r) => r.kind === 'exposure-close')).toHaveLength(1);
    f.db.close();
  });
  it("never closes a concurrent tab's active playback with a fresh presence lease", async () => {
    const f = await fixture(memoryStorage());
    const now = occurred + 86_400_000;
    vi.stubGlobal('navigator', {});
    touchCapturePresence('previous-document', now);
    await recoverInterruptedEvidence('unclaimed', () => true, { now: () => now });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('does not recover a live tab whose presence lease only recently expired', async () => {
    const f = await fixture(memoryStorage());
    const now = occurred + 86_400_000;
    vi.stubGlobal('navigator', {});
    touchCapturePresence('previous-document', now - 21_000);
    await recoverInterruptedEvidence('unclaimed', () => true, { now: () => now });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('recovers a lease that has been expired for the conservative grace', async () => {
    const f = await fixture(memoryStorage());
    const now = occurred + 86_400_000;
    vi.stubGlobal('navigator', {});
    touchCapturePresence('previous-document', now - 21_000 - 61_000);
    await recoverInterruptedEvidence('unclaimed', () => true, { now: () => now });
    expect((await f.repo.all()).some((record) => record.kind === 'exposure-close')).toBe(true);
    f.db.close();
  });
  it('stays conservative when presence storage is unavailable', async () => {
    const f = await fixture();
    vi.stubGlobal('navigator', {});
    await recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred + 86_400_000
    });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('recovers this tab’s predecessor immediately after a clean reload', async () => {
    const local = memoryStorage();
    const f = await fixture(local);
    const previous = captureProcessId();
    const store = f.db.transaction('records', 'readwrite').objectStore('records');
    const row = await reqToPromise(store.get(['unclaimed', 'old-open']));
    await reqToPromise(store.put({ ...row, processId: previous }));
    const session = memoryStorage();
    session.setItem('opencw:learning-evidence-process', previous);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {
      indexedDB: f.factory,
      localStorage: local,
      sessionStorage: session
    });
    markCaptureCleanShutdown(previous);
    vi.resetModules();
    const reloaded = await import('./recovery');
    // The clean-shutdown marker, not copied identity alone, permits immediate
    // recovery of a fresh predecessor record.
    await reloaded.recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred + 1
    });
    const records = await f.repo.all();
    expect(records.some((r) => r.kind === 'exposure-close')).toBe(true);
    f.db.close();
  });
  it('never recovers a cloned predecessor whose presence lease is still alive', async () => {
    const local = memoryStorage();
    const f = await fixture(local);
    const previous = captureProcessId(),
      now = occurred + 86_400_000;
    const store = f.db.transaction('records', 'readwrite').objectStore('records');
    const row = await reqToPromise(store.get(['unclaimed', 'old-open']));
    await reqToPromise(store.put({ ...row, processId: previous }));
    const session = memoryStorage();
    session.setItem('opencw:learning-evidence-process', previous);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {
      indexedDB: f.factory,
      localStorage: local,
      sessionStorage: session
    });
    touchCapturePresence(previous, now);
    vi.resetModules();
    const reloaded = await import('./recovery');
    await reloaded.recoverInterruptedEvidence('unclaimed', () => true, { now: () => now });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('recovers an old predecessor without a marker only after the conservative grace', async () => {
    const local = memoryStorage();
    const f = await fixture(local);
    const previous = captureProcessId(),
      now = occurred + 61_000;
    const store = f.db.transaction('records', 'readwrite').objectStore('records');
    const row = await reqToPromise(store.get(['unclaimed', 'old-open']));
    await reqToPromise(store.put({ ...row, processId: previous }));
    const session = memoryStorage();
    session.setItem('opencw:learning-evidence-process', previous);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {
      indexedDB: f.factory,
      localStorage: local,
      sessionStorage: session
    });
    vi.resetModules();
    const reloaded = await import('./recovery');
    await reloaded.recoverInterruptedEvidence('unclaimed', () => true, { now: () => now });
    expect((await f.repo.all()).some((record) => record.kind === 'exposure-close')).toBe(true);
    f.db.close();
  });
  it('leaves a fresh predecessor unresolved without a clean-shutdown marker', async () => {
    const local = memoryStorage();
    const f = await fixture(local);
    const previous = captureProcessId();
    const store = f.db.transaction('records', 'readwrite').objectStore('records');
    const row = await reqToPromise(store.get(['unclaimed', 'old-open']));
    await reqToPromise(store.put({ ...row, processId: previous }));
    const session = memoryStorage();
    session.setItem('opencw:learning-evidence-process', previous);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {
      indexedDB: f.factory,
      localStorage: local,
      sessionStorage: session
    });
    vi.resetModules();
    const reloaded = await import('./recovery');
    await reloaded.recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred + 1
    });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('records a clean shutdown marker for a genuine unload', async () => {
    const local = memoryStorage(),
      session = memoryStorage();
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        indexedDB: new IDBFactory(),
        localStorage: local,
        sessionStorage: session
      })
    );
    vi.stubGlobal('navigator', {});
    vi.resetModules();
    const recovery = await import('./recovery');
    const evidence = await import('../data/learning-evidence');
    const dispose = recovery.retainCaptureLease();
    const process = evidence.captureProcessId();
    const event = new Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    expect(session.getItem('opencw:learning-evidence-shutdown')).toBe(process);
    dispose();
  });
  it('does not mark a BFCache suspension as a clean shutdown', async () => {
    const local = memoryStorage(),
      session = memoryStorage();
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        indexedDB: new IDBFactory(),
        localStorage: local,
        sessionStorage: session
      })
    );
    vi.stubGlobal('navigator', {});
    vi.resetModules();
    const recovery = await import('./recovery');
    const dispose = recovery.retainCaptureLease();
    const event = new Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    expect(session.getItem('opencw:learning-evidence-shutdown')).toBeNull();
    dispose();
  });
  it('stays owner-scoped and stops when the account changes', async () => {
    const f = await fixture(memoryStorage());
    const now = occurred + 86_400_000;
    vi.stubGlobal('navigator', {});
    await recoverInterruptedEvidence('account:other', () => true, { now: () => now });
    await recoverInterruptedEvidence('unclaimed', () => false, { now: () => now });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('does not let a backward wall-clock jump close another process', async () => {
    const f = await fixture(memoryStorage());
    vi.stubGlobal('navigator', {});
    await recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred - 86_400_000
    });
    expect(await f.repo.all()).toHaveLength(1);
    f.db.close();
  });
  it('abandons an old plan but keeps a checkpointed resumable one', async () => {
    const f = await fixture(memoryStorage());
    await f.repo.append([
      {
        id: 'plan_old',
        kind: 'plan',
        policy_version: 'learning-policy-1.0',
        recorded_at: '2026-10-26T00:00:00Z',
        session_id: 'old_session'
      }
    ]);
    const store = f.db.transaction('records', 'readwrite').objectStore('records');
    const row = await reqToPromise(store.get(['unclaimed', 'plan_old']));
    await reqToPromise(store.put({ ...row, processId: 'previous-document' }));
    vi.stubGlobal('navigator', {});
    await recoverInterruptedEvidence('unclaimed', () => true, {
      now: () => occurred + 86_400_000
    });
    expect((await f.repo.all()).filter((r) => r.kind === 'terminal')).toEqual([
      expect.objectContaining({ session_id: 'old_session', status: 'abandoned' })
    ]);
    f.db.close();
  });
});

it('abandons an orphaned local plan with its actual observation manifest', async () => {
  const f = await fixture();
  await f.repo.append([
    {
      id: 'plan_old',
      kind: 'plan',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-26T00:00:00Z',
      session_id: 'old_session'
    }
  ]);
  const tx = f.db.transaction('records', 'readwrite'),
    store = tx.objectStore('records');
  const plan = await reqToPromise(store.get(['unclaimed', 'plan_old']));
  await reqToPromise(store.put({ ...plan, processId: 'previous-document' }));
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_n: unknown, _o: unknown, fn: (lock: object) => Promise<void>) => fn({})
    }
  });
  await recoverInterruptedEvidence('unclaimed', () => true);
  await recoverInterruptedEvidence('unclaimed', () => true);
  expect((await f.repo.all()).filter((r) => r.kind === 'terminal')).toEqual([
    expect.objectContaining({ session_id: 'old_session', status: 'abandoned', observation_ids: [] })
  ]);
  f.db.close();
});

it('retains a resumable plan while conservatively closing its old exposure', async () => {
  const f = await fixture();
  await f.repo.append([
    {
      id: 'resumable',
      kind: 'plan',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-26T00:00:00Z',
      session_id: 'saved'
    }
  ]);
  const store = f.db.transaction('records', 'readwrite').objectStore('records');
  const row = await reqToPromise(store.get(['unclaimed', 'resumable']));
  await reqToPromise(store.put({ ...row, processId: 'previous-document' }));
  await f.repo.setCheckpoint('saved', { kind: 'guided', id: 'saved' });
  vi.stubGlobal('navigator', {
    locks: {
      request: async (_n: unknown, _o: unknown, fn: (lock: object) => Promise<void>) => fn({})
    }
  });
  await recoverInterruptedEvidence('unclaimed', () => true);
  const records = await f.repo.all();
  expect(records.some((r) => r.kind === 'terminal')).toBe(false);
  expect(records.some((r) => r.kind === 'exposure-close')).toBe(true);
  f.db.close();
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb
} from '../data/learning-evidence';
import { recoverInterruptedEvidence } from './recovery';
import { reqToPromise } from '../data/training-db';
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const factory = new IDBFactory();
  vi.stubGlobal('window', { indexedDB: factory });
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
  return { db, repo };
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

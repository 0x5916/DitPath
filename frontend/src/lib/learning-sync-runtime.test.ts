import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const auth = vi.hoisted(() => ({
  id: 'a' as string | null,
  generation: 1,
  listeners: new Set<() => void>(),
  request: vi.fn()
}));
vi.mock('./auth', () => ({
  getAuthAccountId: () => auth.id,
  getAuthSession: () => ({ generation: auth.generation }),
  isAuthSessionCurrent: (s: { generation: number }) => s.generation === auth.generation,
  apiFetch: (...args: unknown[]) => auth.request(...args),
  user: {
    subscribe(fn: () => void) {
      auth.listeners.add(fn);
      fn();
      return () => auth.listeners.delete(fn);
    }
  }
}));
let runtime: typeof import('./learning-sync.svelte');
let dispose: (() => void) | undefined;
beforeEach(async () => {
  vi.resetModules();
  auth.id = 'a';
  auth.generation++;
  auth.listeners.clear();
  auth.request.mockReset();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { indexedDB: new IDBFactory() }));
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('BroadcastChannel', undefined);
  auth.request.mockImplementation(async () =>
    Response.json({ changes: [], has_more: false, next_cursor: 'cp' })
  );
  runtime = await import('./learning-sync.svelte');
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});
describe('learning evidence sync lifecycle', () => {
  it('does no work before mount and does not loop on downloaded page notifications', async () => {
    expect(auth.request).not.toHaveBeenCalled();
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(runtime.learningSyncState.synced).toBe(true));
    const calls = auth.request.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(auth.request.mock.calls.length).toBe(calls);
    dispose();
    dispose = undefined;
    window.dispatchEvent(new Event('online'));
    expect(auth.request.mock.calls.length).toBe(calls);
  });
  it('marks offline coverage incomplete independently of the previous checkpoint', async () => {
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(runtime.learningSyncState.synced).toBe(true));
    expect(runtime.learningEvidenceCoverage('account:a')).toBe('complete');
    vi.stubGlobal('navigator', { onLine: false });
    window.dispatchEvent(new Event('offline'));
    expect(runtime.learningEvidenceCoverage('account:a')).toBe('partial');
    expect(runtime.learningEvidenceCoverage('account:b')).toBe('partial');
  });
  it('stops automatic retries when the endpoint is unavailable', async () => {
    auth.request.mockImplementation(async () =>
      Response.json({ code: 'NOT_FOUND' }, { status: 404 })
    );
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(runtime.learningSyncState.unavailable).toBe(true));
    expect(runtime.learningSyncState.synced).toBe(false);
    expect(auth.request).toHaveBeenCalledOnce();
  });
  it('clears old-owner state and fences a late response', async () => {
    let release!: (r: Response) => void;
    auth.request.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    auth.id = 'b';
    auth.generation++;
    for (const fn of auth.listeners) fn();
    expect(runtime.learningSyncState.owner).toBe('account:b');
    expect(runtime.learningSyncState.synced).toBe(false);
    release(Response.json({ changes: [], next_cursor: 'old', has_more: false }));
    await vi.waitFor(() => expect(runtime.learningSyncState.synced).toBe(true));
    const { openLearningEvidenceDb, createLearningEvidenceRepository } =
      await import('./data/learning-evidence');
    const db = await openLearningEvidenceDb();
    try {
      expect(await createLearningEvidenceRepository(db, 'account:a').getCursor()).toBeNull();
      expect(await createLearningEvidenceRepository(db, 'account:b').getCursor()).toBe('cp');
    } finally {
      db.close();
    }
  });
});

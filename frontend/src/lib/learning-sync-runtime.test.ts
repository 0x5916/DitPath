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
const recovery = vi.hoisted(() => ({
  recover: vi.fn<() => Promise<void>>(),
  lease: vi.fn(() => () => {})
}));
vi.mock('./learning-evidence/recovery', () => ({
  recoverInterruptedEvidence: recovery.recover,
  retainCaptureLease: recovery.lease
}));
let runtime: typeof import('./learning-sync.svelte');
let dispose: (() => void) | undefined;
beforeEach(async () => {
  vi.resetModules();
  auth.id = 'a';
  auth.generation++;
  auth.listeners.clear();
  auth.request.mockReset();
  recovery.recover.mockReset().mockResolvedValue(undefined);
  recovery.lease.mockClear();
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
  it('keeps coverage pending until the initial sync pass drains', async () => {
    let release!: (response: Response) => void;
    auth.request.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve))
    );
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(runtime.learningSyncState.initialized).toBe(false);

    release(Response.json({ changes: [], next_cursor: 'cp', has_more: false }));
    await vi.waitFor(() => expect(runtime.learningSyncState.initialized).toBe(true));
    expect(runtime.learningSyncState.syncing).toBe(false);
  });

  it('does not queue a redundant initial pass when recovery finds nothing', async () => {
    recovery.recover.mockResolvedValue(undefined);
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(runtime.learningSyncState.initialized).toBe(true));
    expect(auth.request).toHaveBeenCalledOnce();
  });

  it('queues exactly one pass when recovery appends evidence', async () => {
    let finishRecovery!: () => void;
    recovery.recover.mockImplementation(async () => {
      await new Promise<void>((resolve) => (finishRecovery = resolve));
      const { openLearningEvidenceDb, createLearningEvidenceRepository } =
        await import('./data/learning-evidence');
      const db = await openLearningEvidenceDb();
      try {
        await createLearningEvidenceRepository(db, 'account:a').append([
          {
            id: 'recovered-open',
            kind: 'exposure-open',
            policy_version: 'learning-policy-1.0',
            recorded_at: '2026-11-03T00:00:00.000Z',
            session_id: null,
            characters: ['K'],
            source: 'reference',
            presentation_id: 'recovered',
            started_at: null
          }
        ]);
      } finally {
        db.close();
      }
    });
    let release!: (response: Response) => void;
    auth.request.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve))
    );
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release(Response.json({ changes: [], next_cursor: 'cp', has_more: false }));
    await vi.waitFor(() => expect(runtime.learningSyncState.initialized).toBe(true));
    expect(auth.request).toHaveBeenCalledOnce();

    finishRecovery();
    await vi.waitFor(() => expect(runtime.learningSyncState.syncing).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(auth.request).toHaveBeenCalledTimes(2);
  });

  it('drains repeated queued local changes and initializes', async () => {
    let release!: (response: Response) => void;
    auth.request.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve))
    );
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const { notifyTrainingDataChange } = await import('./data/training-data-events');
    for (let index = 0; index < 3; index++)
      notifyTrainingDataChange('account:a', true, 'learning-evidence');

    release(Response.json({ changes: [], next_cursor: 'cp', has_more: false }));
    await vi.waitFor(() => expect(runtime.learningSyncState.initialized).toBe(true));
    expect(auth.request).toHaveBeenCalledTimes(2);
  });

  it('coalesces focus and visibility wake-ups into one empty pass', async () => {
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(runtime.learningSyncState.synced).toBe(true));
    const calls = auth.request.mock.calls.length;
    const version = runtime.learningSyncState.version;

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(runtime.learningSyncState.syncing).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(auth.request.mock.calls.length).toBe(calls + 1);
    expect(runtime.learningSyncState.version).toBe(version);
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
    await vi.waitFor(() => expect(runtime.learningSyncState.initialized).toBe(true));
    expect(runtime.learningSyncState.synced).toBe(false);
    expect(auth.request).toHaveBeenCalledOnce();
  });
  it('treats permanent evidence rejection as terminal and keeps coverage usable', async () => {
    const { openLearningEvidenceDb, createLearningEvidenceRepository } =
      await import('./data/learning-evidence');
    const db = await openLearningEvidenceDb(window.indexedDB);
    const repository = createLearningEvidenceRepository(db, 'account:a');
    const recorded_at = '2026-10-27T00:00:00.000Z';
    await repository.append([
      {
        id: 'plan',
        kind: 'plan',
        policy_version: 'learning-policy-1.0',
        recorded_at,
        session_id: 's1'
      },
      {
        id: 'observation',
        kind: 'observation',
        policy_version: 'learning-policy-1.0',
        recorded_at,
        session_id: 's1'
      }
    ]);
    db.close();
    auth.request.mockImplementation(async (path: string) =>
      path.endsWith('/batch')
        ? Response.json({
            acknowledged_ids: [],
            rejected_records: [
              { id: 'plan', error_code: 'ID_CONFLICT', message: 'bad', retryable: false },
              {
                id: 'observation',
                error_code: 'MISSING_EVIDENCE_DEPENDENCY',
                message: 'missing',
                retryable: true
              }
            ]
          })
        : Response.json({ changes: [], next_cursor: 'cp', has_more: false })
    );
    dispose = runtime.initializeLearningSync();
    await vi.waitFor(() => expect(runtime.learningSyncState.rejected).toBe(1));
    expect(runtime.learningSyncState).toMatchObject({
      rejected: 1,
      blocked: 1,
      error: null,
      synced: true
    });
    expect(runtime.learningEvidenceCoverage('account:a')).toBe('complete');
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
    expect(runtime.learningSyncState.initialized).toBe(true);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const auth = vi.hoisted(() => ({
  id: '11111111-1111-4111-8111-111111111111' as string | null,
  generation: 1,
  listeners: new Set<() => void>(),
  request: vi.fn()
}));
vi.mock('./auth', () => ({
  getAuthAccountId: () => auth.id,
  getAuthSession: () => ({ generation: auth.generation, username: auth.id }),
  isAuthSessionCurrent: (session: { generation: number }) => session.generation === auth.generation,
  apiFetch: (...args: unknown[]) => auth.request(...args),
  user: {
    subscribe(listener: () => void) {
      auth.listeners.add(listener);
      listener();
      return () => auth.listeners.delete(listener);
    }
  }
}));

let runtime: typeof import('./training-sync.svelte');
let dispose: (() => void) | undefined;
beforeEach(async () => {
  vi.resetModules();
  auth.id = '11111111-1111-4111-8111-111111111111';
  auth.generation++;
  auth.listeners.clear();
  auth.request.mockReset();
  const windowTarget = new EventTarget();
  Object.assign(windowTarget, { indexedDB: new IDBFactory() });
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('BroadcastChannel', undefined);
  auth.request.mockImplementation(async () =>
    Response.json({ changes: [], has_more: false, next_cursor: 'checkpoint' })
  );
  runtime = await import('./training-sync.svelte');
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('training sync browser lifecycle', () => {
  it('leaves timeout recovery visible and allows manual retry before automatic retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { RequestTimeoutError, REQUEST_TIMEOUT_MS } = await import('./request-timeout');
    auth.request.mockRejectedValueOnce(new RequestTimeoutError());
    const idleError = Promise.withResolvers<void>();
    const unsubscribe = runtime.subscribeTrainingSync(({ syncing, error }) => {
      if (!syncing && error === 'TRAINING_SYNC_FAILED') idleError.resolve();
    });
    dispose = runtime.initializeTrainingSync();
    await idleError.promise;
    unsubscribe();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(runtime.trainingSyncState).toMatchObject({
      syncing: false,
      error: 'TRAINING_SYNC_FAILED'
    });
    expect(auth.request).toHaveBeenCalledOnce();
    await runtime.syncTrainingNow();
    expect(runtime.trainingSyncState.synced).toBe(true);
    expect(runtime.trainingSyncState.error).toBeNull();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(auth.request).toHaveBeenCalledTimes(2);
  });

  it('awaits a new request when a subscriber retries on the first idle error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { RequestTimeoutError, REQUEST_TIMEOUT_MS } = await import('./request-timeout');
    const secondRequest = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    auth.request.mockRejectedValueOnce(new RequestTimeoutError()).mockImplementationOnce(() => {
      secondRequest.resolve();
      return response.promise;
    });
    const retry = Promise.withResolvers<void>();
    const unsubscribe = runtime.subscribeTrainingSync(({ syncing, error }) => {
      if (syncing || error !== 'TRAINING_SYNC_FAILED') return;
      unsubscribe();
      retry.resolve(runtime.syncTrainingNow());
    });
    dispose = runtime.initializeTrainingSync();

    let settled = false;
    const completed = retry.promise.then(() => {
      settled = true;
    });
    expect(
      await Promise.race([
        secondRequest.promise.then(() => 'requested'),
        completed.then(() => 'completed')
      ])
    ).toBe('requested');
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    expect(runtime.trainingSyncState.syncing).toBe(true);
    response.resolve(Response.json({ changes: [], has_more: false, next_cursor: 'retried' }));
    await completed;
    expect(runtime.trainingSyncState).toMatchObject({ syncing: false, synced: true, error: null });
    expect(auth.request).toHaveBeenCalledTimes(2);
  });

  it('creates no network work before mount and disposes wake listeners', async () => {
    expect(auth.request).not.toHaveBeenCalled();
    dispose = runtime.initializeTrainingSync();
    await vi.waitFor(() => expect(auth.request).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runtime.trainingSyncState.syncing).toBe(false));
    dispose();
    dispose = undefined;
    window.dispatchEvent(new Event('online'));
    expect(auth.request).toHaveBeenCalledOnce();
  });

  it('clears the rendered owner immediately and cancels a previous account response', async () => {
    let release!: (response: Response) => void;
    auth.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );
    dispose = runtime.initializeTrainingSync();
    await vi.waitFor(() => expect(auth.request).toHaveBeenCalledOnce());
    auth.id = '22222222-2222-4222-8222-222222222222';
    auth.generation++;
    for (const listener of auth.listeners) listener();
    expect(runtime.trainingSyncState.owner).toBe(`account:${auth.id}`);
    expect(runtime.trainingSyncState.pending).toBe(0);
    await vi.waitFor(() => expect(auth.request).toHaveBeenCalledTimes(2));
    release(Response.json({ changes: [], has_more: false, next_cursor: 'old-account' }));
    await vi.waitFor(() => expect(runtime.trainingSyncState.syncing).toBe(false));
    const { openTrainingDb } = await import('./data/training-db');
    const { createTrainingSyncRepository } = await import('./data/training-sync-repository');
    const db = await openTrainingDb();
    try {
      expect(
        await createTrainingSyncRepository(
          db,
          'account:11111111-1111-4111-8111-111111111111'
        ).getCursor()
      ).toBeNull();
      expect(await createTrainingSyncRepository(db, `account:${auth.id}`).getCursor()).toBe(
        'checkpoint'
      );
    } finally {
      db.close();
    }
  });

  it('refreshes local review views without invalidating or triggering legacy synchronization', async () => {
    dispose = runtime.initializeTrainingSync();
    await vi.waitFor(() => expect(runtime.trainingSyncState.synced).toBe(true));
    const before = runtime.trainingSyncState.version;
    const calls = auth.request.mock.calls.length;
    const { notifyTrainingDataChange } = await import('./data/training-data-events');
    notifyTrainingDataChange(runtime.getTrainingOwner(), false, 'learning-pilot');
    expect(runtime.trainingSyncState.version).toBe(before + 1);
    expect(runtime.trainingSyncState.synced).toBe(true);
    expect(auth.request).toHaveBeenCalledTimes(calls);
    notifyTrainingDataChange('unclaimed', false, 'learning-pilot');
    expect(runtime.trainingSyncState.version).toBe(before + 1);
  });

  it('uses reconnect to upload a durable practice record saved while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    dispose = runtime.initializeTrainingSync();
    const { openTrainingDb } = await import('./data/training-db');
    const { createSessionRepository } = await import('./data/session-repository');
    const db = await openTrainingDb();
    try {
      await createSessionRepository(db, runtime.getTrainingOwner()).saveSession({
        schemaVersion: 1,
        id: 'offline',
        mode: 'practice',
        step: 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-20T00:00:00Z',
        completedAt: '2026-10-20T00:01:00Z',
        status: 'completed',
        promptCount: 1,
        completedPromptCount: 1,
        accuracy: 0.8
      });
      await vi.waitFor(() => expect(runtime.trainingSyncState.pending).toBe(1));
      expect(auth.request).not.toHaveBeenCalled();
      auth.request.mockImplementation(async (path: string) =>
        path.includes('/batch')
          ? Response.json({ acknowledged_ids: ['offline'], rejected_sessions: [] })
          : Response.json({ changes: [], has_more: false, next_cursor: 'restored' })
      );
      vi.stubGlobal('navigator', { onLine: true });
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(runtime.trainingSyncState.pending).toBe(0));
      expect(
        auth.request.mock.calls.some(([path]) => String(path).includes('/sessions/batch'))
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});

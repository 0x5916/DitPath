import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  coverage: vi.fn(),
  syncState: { owner: 'account:a', initialized: true, syncing: false },
  training: null as ((state: Record<string, unknown>) => void) | null,
  learning: null as ((state: Record<string, unknown>) => void) | null
}));

vi.mock('./data/learning-snapshot', () => ({
  loadLearningSnapshot: mocks.load
}));

vi.mock('./learning-sync.svelte', () => ({
  learningEvidenceCoverage: mocks.coverage,
  learningSyncState: mocks.syncState,
  subscribeLearningSync(listener: (state: Record<string, unknown>) => void) {
    mocks.learning = listener;
    listener({
      owner: 'account:a',
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: mocks.syncState.initialized,
      syncing: mocks.syncState.syncing,
      synced: true,
      unavailable: false,
      error: null,
      version: 0
    });
    return () => {};
  }
}));

vi.mock('./training-sync.svelte', () => ({
  getTrainingOwner: () => 'account:a',
  subscribeTrainingSync(listener: (state: Record<string, unknown>) => void) {
    mocks.training = listener;
    listener({
      owner: 'account:a',
      pending: 0,
      error: null,
      syncing: false,
      synced: true,
      version: 0
    });
    return () => {};
  }
}));

beforeEach(() => {
  vi.resetModules();
  mocks.load.mockReset().mockResolvedValue({ ownerKey: 'account:a' });
  mocks.coverage.mockReset().mockReturnValue('complete');
  mocks.syncState.owner = 'account:a';
  mocks.syncState.initialized = true;
  mocks.syncState.syncing = false;
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('learning projection lifecycle', () => {
  it('coalesces initial subscriptions and waits for sync coverage to settle', async () => {
    const { createLearningView } = await import('./learning-view.svelte');
    const view = createLearningView();
    const stop = view.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(1);

    mocks.learning?.({
      owner: 'account:a',
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: false,
      syncing: true,
      synced: false,
      unavailable: false,
      error: null,
      version: 0
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(1);

    mocks.learning?.({
      owner: 'account:a',
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: true,
      syncing: false,
      synced: true,
      unavailable: false,
      error: null,
      version: 0
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(2);

    mocks.learning?.({
      owner: 'account:a',
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: true,
      syncing: false,
      synced: true,
      unavailable: false,
      error: null,
      version: 0
    });
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(2);

    mocks.training?.({
      owner: 'account:a',
      pending: 0,
      error: null,
      syncing: true,
      synced: false,
      version: 0
    });
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(2);

    stop();
  });

  it('marks a projection settled only after coverage initialization', async () => {
    mocks.syncState.initialized = false;
    const { createLearningView } = await import('./learning-view.svelte');
    const view = createLearningView();
    const stop = view.start();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(view.snapshot).not.toBeNull());
    expect(view.settled).toBe(false);

    mocks.syncState.initialized = true;
    mocks.learning?.({
      owner: 'account:a',
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: true,
      syncing: false,
      synced: true,
      unavailable: false,
      error: null,
      version: 0
    });
    await vi.waitFor(() => expect(view.settled).toBe(true));

    stop();
  });

  it('keeps a settled projection through a transient partial read', async () => {
    const first = { ownerKey: 'account:a', coverage: 'complete' };
    mocks.load.mockResolvedValue(first);
    const { createLearningView } = await import('./learning-view.svelte');
    const view = createLearningView();
    const stop = view.start();
    await vi.waitFor(() => expect(view.settled).toBe(true));
    expect(view.snapshot).toBe(first);

    const transient = { ownerKey: 'account:a', coverage: 'partial' };
    mocks.load.mockResolvedValue(transient);
    mocks.syncState.syncing = true;
    await view.refresh();
    expect(view.snapshot).toBe(first);
    expect(view.settled).toBe(true);

    stop();
  });

  it('does not publish a late projection after stop', async () => {
    let resolveLoad!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => (resolveLoad = resolve)));
    const { createLearningView } = await import('./learning-view.svelte');
    const view = createLearningView();
    const stop = view.start();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));

    stop();
    resolveLoad({ ownerKey: 'account:a', coverage: 'complete', claim: 'late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.snapshot).toBeNull();
    expect(view.settled).toBe(false);
  });

  it('forces a new projection when a data revision changes during sync', async () => {
    const first = { ownerKey: 'account:a', coverage: 'complete', claim: 'stale' };
    mocks.load.mockResolvedValue(first);
    const { createLearningView } = await import('./learning-view.svelte');
    const view = createLearningView();
    const stop = view.start();
    await vi.waitFor(() => expect(view.settled).toBe(true));
    expect(view.snapshot).toBe(first);

    const corrected = { ownerKey: 'account:a', coverage: 'partial', claim: 'corrected' };
    mocks.load.mockResolvedValue(corrected);
    mocks.coverage.mockReturnValue('partial');
    mocks.syncState.syncing = true;
    mocks.training?.({
      owner: 'account:a',
      pending: 0,
      error: null,
      syncing: true,
      synced: false,
      version: 1
    });
    await vi.waitFor(() => expect(view.snapshot).toBe(corrected));
    expect(view.settled).toBe(true);
    expect(mocks.load.mock.calls.at(-1)?.[0]).toMatchObject({
      ownerKey: 'account:a',
      coverage: 'complete'
    });

    mocks.syncState.syncing = false;
    const callsBeforeSettle = mocks.load.mock.calls.length;
    mocks.learning?.({
      owner: 'account:a',
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: true,
      syncing: false,
      synced: true,
      unavailable: false,
      error: null,
      version: 1
    });
    await vi.waitFor(() => expect(mocks.load.mock.calls.length).toBe(callsBeforeSettle + 1));
    expect(mocks.load.mock.calls.at(-1)?.[0]).toMatchObject({
      ownerKey: 'account:a',
      coverage: 'partial'
    });
    expect(view.settled).toBe(true);
    expect(view.snapshot).toBe(corrected);

    stop();
  });

  it('does not replace a resolved projection on focus while a sync pass is running', async () => {
    const { createLearningView } = await import('./learning-view.svelte');
    const view = createLearningView();
    const stop = view.start();
    await Promise.resolve();
    await Promise.resolve();
    const calls = mocks.load.mock.calls.length;

    mocks.syncState.syncing = true;
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(calls);

    mocks.syncState.syncing = false;
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).toHaveBeenCalledTimes(calls + 1);

    stop();
  });
});

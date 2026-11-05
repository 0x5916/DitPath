import { describe, expect, it, vi } from 'vitest';
import type { CopyCheckpoint, SessionCheckpoint } from '../data/session-checkpoints';
import { copyPlaybackEvent, emptyCopyAttempt, type CopyAttempt } from './copy-attempt';
import { createCopyCheckpointStore, type CopyCheckpointPorts } from './copy-checkpoint.svelte';

function activeAttempt(): CopyAttempt {
  return copyPlaybackEvent(
    { ...emptyCopyAttempt(), id: 'attempt-1', exercise: { lesson: 1, text: 'KM' } },
    'start',
    '2026-11-01T00:00:00.000Z'
  );
}

function copyCheckpoint(draft = 'KM'): CopyCheckpoint {
  return {
    version: 1,
    kind: 'copy',
    id: 'copy',
    href: '/morse/practice',
    savedAt: '2026-11-01T00:00:01.000Z',
    draft,
    attempt: activeAttempt()
  };
}

function fakePorts(overrides: Partial<CopyCheckpointPorts> = {}) {
  let owner = 'guest';
  let checkpoint: CopyCheckpoint | null = null;
  const release = vi.fn(async () => {});
  const released = vi.fn(async () => {
    await release();
  });
  const ports: CopyCheckpointPorts = {
    owner: () => owner,
    load: vi.fn(async () => checkpoint),
    save: vi.fn(async (_owner, value) => {
      checkpoint = value;
    }),
    remove: vi.fn(async () => {
      checkpoint = null;
    }),
    discard: vi.fn(async () => {
      checkpoint = null;
    }),
    claim: vi.fn(async () => released),
    ...overrides
  };
  return {
    ports,
    released,
    setOwner: (value: string) => (owner = value),
    setCheckpoint: (value: CopyCheckpoint | null) => (checkpoint = value),
    get checkpoint() {
      return checkpoint;
    }
  };
}

describe('copy checkpoint store', () => {
  it('claims the session lease when no checkpoint exists', async () => {
    const fake = fakePorts();
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();

    expect(store.saved).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.blocked).toBe(false);
    expect(store.saveError).toBe(false);
    expect(fake.ports.claim).toHaveBeenCalledWith('guest', 'copy');
    await store.dispose();
    expect(fake.released).toHaveBeenCalled();
  });

  it('loads and resumes an existing checkpoint with the resuming lease', async () => {
    const fake = fakePorts();
    const value = copyCheckpoint('K');
    fake.setCheckpoint(value);
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    expect(store.saved).toEqual(value);

    await store.resume(value);
    expect(store.saved).toBeNull();
    expect(store.restore).toEqual(value);
    expect(store.loading).toBe(false);
    expect(fake.ports.claim).toHaveBeenLastCalledWith('guest', 'copy', true);
    await store.dispose();
  });

  it('restores the stored checkpoint rather than the stale card value', async () => {
    const fake = fakePorts();
    const stale = copyCheckpoint('K');
    const latest = copyCheckpoint('KM');
    fake.setCheckpoint(stale);
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    fake.setCheckpoint(latest);

    await store.resume(stale);

    expect(store.restore).toEqual(latest);
    expect(store.saved).toBeNull();
    expect(store.blocked).toBe(false);
    await store.dispose();
  });

  it('starts a fresh session when another tab discarded the saved checkpoint', async () => {
    const fake = fakePorts();
    const stale = copyCheckpoint();
    fake.setCheckpoint(stale);
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    fake.setCheckpoint(null);

    await store.resume(stale);

    expect(store.restore).toBeNull();
    expect(store.saved).toBeNull();
    expect(store.hasWork).toBe(false);
    expect(store.loading).toBe(false);
    expect(fake.released).not.toHaveBeenCalled();
    await store.dispose();
  });

  it('ignores a repeated resume while the first claim is pending', async () => {
    let resolveClaim: (release: () => Promise<void>) => void = () => {};
    const fake = fakePorts();
    const released = vi.fn(async () => {});
    fake.ports.claim = vi.fn(
      (_owner, _id, resuming?: boolean) =>
        new Promise<() => Promise<void>>((resolve) => {
          if (resuming) resolveClaim = resolve;
          else resolve(released);
        })
    );
    const store = createCopyCheckpointStore(fake.ports);
    const checkpoint = copyCheckpoint();
    fake.setCheckpoint(checkpoint);
    await store.load();

    const first = store.resume(checkpoint);
    const second = store.resume(checkpoint);
    resolveClaim(released);
    await Promise.all([first, second]);

    expect(fake.ports.claim).toHaveBeenCalledTimes(1);
    expect(store.restore).toEqual(checkpoint);
    expect(store.blocked).toBe(false);
    expect(store.saveError).toBe(false);
    await store.dispose();
  });

  it('reports a failed resume lease without claiming a save failure', async () => {
    const fake = fakePorts({
      claim: vi.fn(async () => {
        throw new Error('Session is active in another tab');
      })
    });
    const store = createCopyCheckpointStore(fake.ports);

    await store.resume(copyCheckpoint());

    expect(store.blocked).toBe(true);
    expect(store.saveError).toBe(false);
    expect(store.loading).toBe(false);
    await store.dispose();
  });

  it('reports a failed load as blocked so retry reloads instead of writing', async () => {
    const fake = fakePorts({
      load: vi.fn(async () => {
        throw new Error('storage unavailable');
      })
    });
    const store = createCopyCheckpointStore(fake.ports);

    await store.load();

    expect(store.blocked).toBe(true);
    expect(store.saveError).toBe(false);
    expect(store.loading).toBe(false);
    await store.dispose();
  });

  it('reports a failed discard as blocked so retry reloads the card', async () => {
    const fake = fakePorts();
    const checkpoint = copyCheckpoint();
    fake.setCheckpoint(checkpoint);
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    vi.mocked(fake.ports.discard).mockRejectedValueOnce(new Error('active in another tab'));

    await store.discard(checkpoint);

    expect(store.blocked).toBe(true);
    expect(store.saveError).toBe(false);
    await store.dispose();
  });

  it('reports a fresh-session lock failure as blocked, not a save failure', async () => {
    const fake = fakePorts({
      claim: vi.fn(async () => {
        throw new Error('Session is active in another tab');
      })
    });
    const store = createCopyCheckpointStore(fake.ports);

    await store.load();

    expect(store.blocked).toBe(true);
    expect(store.saveError).toBe(false);
    expect(store.loading).toBe(false);
    await store.dispose();
  });

  it('clears a checkpoint only when it belongs to the saved attempt', async () => {
    const fake = fakePorts();
    const value = copyCheckpoint();
    fake.setCheckpoint(value);
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();

    await store.clearForAttempt('other-attempt');
    expect(fake.checkpoint).toEqual(value);

    await store.clearForAttempt('attempt-1');
    expect(fake.checkpoint).toBeNull();
    await store.dispose();
  });

  it('clears the checkpoint and retry target on departure', async () => {
    const fake = fakePorts();
    fake.setCheckpoint(copyCheckpoint());
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    await store.clear();
    expect(fake.checkpoint).toBeNull();

    store.retry();
    await store.whenIdle();
    expect(fake.ports.save).not.toHaveBeenCalled();
    await store.dispose();
  });

  it('drops a resume when a newer load starts while the lease is pending', async () => {
    let resolveClaim: (release: () => Promise<void>) => void = () => {};
    const fake = fakePorts();
    const released = vi.fn(async () => {});
    const claim = vi.fn((_owner, _id, resuming?: boolean) =>
      resuming
        ? new Promise<() => Promise<void>>((resolve) => {
            resolveClaim = resolve;
          })
        : Promise.resolve(released)
    );
    fake.ports.claim = claim;
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();

    const resuming = store.resume(copyCheckpoint());
    await store.load();
    resolveClaim(released);
    await resuming;

    expect(store.restore).toBeNull();
    expect(released).toHaveBeenCalled();
    await store.dispose();
  });

  it('orders departure clear after pending writes and suppresses late checkpoints', async () => {
    let finishSave = () => {};
    const events: string[] = [];
    const fake = fakePorts({
      save: vi.fn(async (_owner, value) => {
        events.push('save-start');
        await new Promise<void>((resolve) => (finishSave = resolve));
        fake.setCheckpoint(value);
        events.push('save-end');
      }),
      remove: vi.fn(async () => {
        events.push('remove');
        fake.setCheckpoint(null);
      })
    });
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    store.checkpoint(activeAttempt(), 'K');
    await Promise.resolve();

    const clearing = store.clear();
    store.checkpoint(activeAttempt(), 'late');
    finishSave();
    await clearing;
    await store.whenIdle();

    expect(events).toEqual(['save-start', 'save-end', 'remove']);
    expect(fake.checkpoint).toBeNull();
    expect(store.hasWork).toBe(true);
    await store.dispose();
  });

  it('orders attempt-specific clear after a pending checkpoint write', async () => {
    let finishSave = () => {};
    const fake = fakePorts({
      save: vi.fn(async (_owner, value) => {
        await new Promise<void>((resolve) => (finishSave = resolve));
        fake.setCheckpoint(value);
      })
    });
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    store.checkpoint(activeAttempt(), 'K');
    await Promise.resolve();

    const clearing = store.clearForAttempt('attempt-1');
    finishSave();
    await clearing;
    await store.whenIdle();

    expect(fake.checkpoint).toBeNull();
    expect(fake.ports.remove).toHaveBeenCalledTimes(1);
    await store.dispose();
  });

  it('propagates a failed clear after preserving the retry target', async () => {
    const fake = fakePorts();
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    store.checkpoint(activeAttempt(), 'K');
    await store.whenIdle();
    vi.mocked(fake.ports.remove).mockRejectedValueOnce(new Error('quota'));

    await expect(store.clear()).rejects.toThrow('quota');
    expect(store.saveError).toBe(true);

    store.retry();
    await store.whenIdle();
    expect(fake.ports.save).toHaveBeenCalledTimes(2);
    await store.dispose();
  });

  it('writes and clears the checkpoint through one serialized queue', async () => {
    const fake = fakePorts();
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    const attempt = activeAttempt();

    store.checkpoint(attempt, 'K');
    store.checkpoint({ ...attempt, session: { ...attempt.session, status: 'ready' } }, '');
    await store.whenIdle();

    expect(fake.ports.save).toHaveBeenCalledTimes(1);
    expect(fake.ports.remove).toHaveBeenCalledTimes(1);
    expect(store.hasWork).toBe(false);
    expect(store.saveError).toBe(false);
    await store.dispose();
  });

  it('keeps work when the attempt has no id or text', async () => {
    const fake = fakePorts();
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    store.checkpoint({ ...activeAttempt(), id: undefined }, 'K');
    store.checkpoint({ ...activeAttempt(), exercise: { lesson: 1, text: '' } }, 'K');
    await store.whenIdle();
    expect(fake.ports.save).not.toHaveBeenCalled();
    await store.dispose();
  });

  it('retries the last write after a failure', async () => {
    const fake = fakePorts();
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    vi.mocked(fake.ports.save).mockRejectedValueOnce(new Error('quota'));
    store.checkpoint(activeAttempt(), 'K');
    await store.whenIdle();
    expect(store.saveError).toBe(true);

    store.retry();
    await store.whenIdle();
    expect(store.saveError).toBe(false);
    expect(fake.ports.save).toHaveBeenCalledTimes(2);
    await store.dispose();
  });

  it('does not retry the previous owner\u2019s failed checkpoint after a reload', async () => {
    const fake = fakePorts();
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    vi.mocked(fake.ports.save).mockRejectedValueOnce(new Error('quota'));
    store.checkpoint(activeAttempt(), 'K');
    await store.whenIdle();
    expect(store.saveError).toBe(true);

    fake.setOwner('account');
    await store.load();
    store.retry();
    await store.whenIdle();

    expect(fake.ports.save).toHaveBeenCalledTimes(1);
    expect(fake.ports.remove).toHaveBeenCalled();
    await store.dispose();
  });

  it('ignores a late load result after the owner changes', async () => {
    let resolveLoad: (value: SessionCheckpoint | null) => void = () => {};
    const fake = fakePorts({
      load: vi.fn(
        () =>
          new Promise<SessionCheckpoint | null>((resolve) => {
            resolveLoad = resolve;
          })
      )
    });
    const store = createCopyCheckpointStore(fake.ports);
    const loading = store.load();
    fake.setOwner('account');
    resolveLoad(copyCheckpoint());
    await loading;
    expect(store.saved).toBeNull();
    await store.dispose();
  });

  it('waits for queued writes before releasing the lease on dispose', async () => {
    let finishWrite = () => {};
    const fake = fakePorts({
      save: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          })
      )
    });
    const store = createCopyCheckpointStore(fake.ports);
    await store.load();
    store.checkpoint(activeAttempt(), 'K');
    const disposing = store.dispose();
    expect(fake.released).not.toHaveBeenCalled();
    await Promise.resolve();
    finishWrite();
    await disposing;
    expect(fake.released).toHaveBeenCalled();
  });
});

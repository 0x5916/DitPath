import { SvelteDate } from 'svelte/reactivity';
import {
  claimSession,
  discardCheckpoint,
  loadCheckpoint,
  removeCheckpoint,
  saveCheckpoint,
  type CopyCheckpoint,
  type SessionCheckpoint
} from '../data/session-checkpoints';
import { getTrainingOwner } from '../training-sync.svelte';
import type { CopyAttempt } from './copy-attempt';

export interface CopyCheckpointPorts {
  load(owner: string, id: 'copy'): Promise<SessionCheckpoint | null>;
  save(owner: string, checkpoint: CopyCheckpoint): Promise<void>;
  remove(owner: string, id: 'copy'): Promise<void>;
  discard(owner: string, checkpoint: SessionCheckpoint): Promise<void>;
  claim(owner: string, id: 'copy', resuming?: boolean): Promise<() => Promise<void>>;
  owner(): string;
}

const defaultPorts: CopyCheckpointPorts = {
  load: loadCheckpoint,
  save: saveCheckpoint,
  remove: removeCheckpoint,
  discard: discardCheckpoint,
  claim: claimSession,
  owner: getTrainingOwner
};

/**
 * Owns the device-local copy checkpoint: load/resume/discard, the serialized
 * write queue, and the same-tab session lease. The route only decides when to
 * checkpoint and what to do after a save failure.
 */
export function createCopyCheckpointStore(overrides: Partial<CopyCheckpointPorts> = {}) {
  const ports = { ...defaultPorts, ...overrides };
  let saved = $state.raw<CopyCheckpoint | null>(null);
  let restore = $state.raw<CopyCheckpoint | null>(null);
  let loading = $state(true);
  let saveError = $state(false);
  let blocked = $state(false);
  let hasWork = $state(false);
  let loadVersion = 0;
  let disposed = false;
  let resuming = false;
  let clearing = false;
  let lease: (() => Promise<void>) | null = null;
  let lastCheckpoint: CopyCheckpoint | null = null;
  let writes = Promise.resolve();

  const current = (owner: string, version: number) =>
    !disposed && owner === ports.owner() && version === loadVersion;

  function enqueue(task: () => Promise<void>, owner: string): Promise<void> {
    const run = writes.then(task);
    writes = run.then(
      () => {
        if (owner === ports.owner()) saveError = false;
      },
      () => {
        if (owner === ports.owner()) saveError = true;
      }
    );
    return run;
  }

  async function load() {
    const owner = ports.owner();
    const version = ++loadVersion;
    loading = true;
    blocked = false;
    saved = null;
    restore = null;
    hasWork = false;
    lastCheckpoint = null;
    try {
      const release = lease;
      lease = null;
      await release?.();
      if (!current(owner, version)) return;
      const checkpoint = await ports.load(owner, 'copy');
      if (!current(owner, version)) return;
      if (checkpoint?.kind === 'copy') {
        saved = checkpoint;
      } else {
        let nextLease: (() => Promise<void>) | null = null;
        try {
          nextLease = await ports.claim(owner, 'copy');
        } catch {
          if (current(owner, version)) blocked = true;
          return;
        }
        if (!current(owner, version)) {
          await nextLease();
          return;
        }
        lease = nextLease;
      }
      saveError = false;
    } catch {
      if (current(owner, version)) blocked = true;
    } finally {
      if (current(owner, version)) loading = false;
    }
  }

  async function discard(checkpoint: SessionCheckpoint) {
    const owner = ports.owner();
    try {
      await ports.discard(owner, checkpoint);
      if (!disposed && owner === ports.owner()) await load();
    } catch {
      if (!disposed && owner === ports.owner()) blocked = true;
    }
  }

  async function resume(checkpoint: SessionCheckpoint) {
    if (checkpoint.kind !== 'copy' || resuming) return;
    const owner = ports.owner();
    const version = loadVersion;
    resuming = true;
    loading = true;
    let nextLease: (() => Promise<void>) | null = null;
    try {
      nextLease = await ports.claim(owner, 'copy', true);
      if (!current(owner, version)) {
        await nextLease();
        nextLease = null;
        return;
      }
      // Another tab can discard or update the checkpoint while this tab still
      // shows its card. Trust the stored value, never the stale card.
      const stored = await ports.load(owner, 'copy');
      if (!current(owner, version)) {
        await nextLease();
        nextLease = null;
        return;
      }
      lease = nextLease;
      nextLease = null;
      restore = stored?.kind === 'copy' ? stored : null;
      saved = null;
      hasWork = false;
      saveError = false;
      blocked = false;
    } catch {
      await nextLease?.().catch(() => {});
      if (current(owner, version)) {
        saveError = false;
        blocked = true;
      }
    } finally {
      resuming = false;
      if (current(owner, version)) loading = false;
    }
  }

  async function clear() {
    const owner = ports.owner();
    clearing = true;
    try {
      await enqueue(async () => {
        await ports.remove(owner, 'copy');
        lastCheckpoint = null;
      }, owner);
    } finally {
      clearing = false;
    }
  }

  /** Remove the checkpoint only when it still belongs to the saved attempt. */
  async function clearForAttempt(attemptId: string) {
    const owner = ports.owner();
    await enqueue(async () => {
      const checkpoint = await ports.load(owner, 'copy');
      if (checkpoint?.kind !== 'copy' || checkpoint.attempt.id !== attemptId) return;
      await ports.remove(owner, 'copy');
      lastCheckpoint = null;
    }, owner);
  }

  function retry() {
    if (clearing) return;
    const owner = ports.owner();
    const checkpoint = lastCheckpoint;
    enqueue(
      () => (checkpoint ? ports.save(owner, checkpoint) : ports.remove(owner, 'copy')),
      owner
    );
  }

  function checkpoint(attempt: CopyAttempt, draft: string) {
    if (clearing || !attempt.id || !attempt.exercise.text) return;
    const owner = ports.owner();
    if (attempt.session.status === 'ready' && !hasWork) return;
    const clear = attempt.session.status === 'ready';
    hasWork = !clear;
    const value: CopyCheckpoint = {
      version: 1,
      kind: 'copy',
      id: 'copy',
      href: '/morse/practice',
      savedAt: new SvelteDate().toISOString(),
      attempt: JSON.parse(JSON.stringify(attempt)),
      draft
    };
    lastCheckpoint = clear ? null : value;
    enqueue(() => (clear ? ports.remove(owner, 'copy') : ports.save(owner, value)), owner);
  }

  function whenIdle(): Promise<void> {
    return writes;
  }

  async function dispose() {
    disposed = true;
    loadVersion++;
    const release = lease;
    lease = null;
    await writes.finally(() => release?.());
  }

  return {
    get saved() {
      return saved;
    },
    get restore() {
      return restore;
    },
    get loading() {
      return loading;
    },
    get saveError() {
      return saveError;
    },
    get blocked() {
      return blocked;
    },
    get hasWork() {
      return hasWork;
    },
    load,
    discard,
    resume,
    retry,
    checkpoint,
    clear,
    clearForAttempt,
    whenIdle,
    dispose
  };
}

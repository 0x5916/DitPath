import { getTrainingOwner, subscribeTrainingEpoch } from './training-owner';
import { requestTrainingData } from './account-data';
export { getTrainingOwner } from './training-owner';
import { getAuthSession, isAuthSessionCurrent, user } from './auth';
import { SvelteSet } from 'svelte/reactivity';
import { openTrainingDb } from './data/training-db';
import {
  createTrainingSyncRepository,
  getTrainingInstallationId,
  subscribeTrainingDataChanges
} from './data/training-sync-repository';
import { synchronizeTraining, TrainingSyncError } from './training-sync-engine';
import { REQUEST_TIMEOUT_MS, RequestTimeoutError } from './request-timeout';

export interface TrainingSyncSnapshot {
  owner: string;
  pending: number;
  error: string | null;
  syncing: boolean;
  synced: boolean;
  version: number;
}
class SyncState implements TrainingSyncSnapshot {
  owner = $state('unclaimed');
  pending = $state(0);
  error = $state<string | null>(null);
  syncing = $state(false);
  synced = $state(false);
  version = $state(0);
}
export const trainingSyncState = new SyncState();
const listeners = new SvelteSet<(state: TrainingSyncSnapshot) => void>();
let mounts = 0;
let disposeRuntime: (() => void) | null = null;
let controller = new AbortController();
let inFlight: { owner: string; generation: number; promise: Promise<void>; rerun: boolean } | null =
  null;
let timer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let mounted = false;

function publish(patch: Partial<TrainingSyncSnapshot>) {
  Object.assign(trainingSyncState, patch);
  const snapshot = {
    owner: trainingSyncState.owner,
    pending: trainingSyncState.pending,
    error: trainingSyncState.error,
    syncing: trainingSyncState.syncing,
    synced: trainingSyncState.synced,
    version: trainingSyncState.version
  };
  for (const listener of listeners) listener(snapshot);
}
export function subscribeTrainingSync(listener: (state: TrainingSyncSnapshot) => void) {
  listeners.add(listener);
  listener({
    owner: trainingSyncState.owner,
    pending: trainingSyncState.pending,
    error: trainingSyncState.error,
    syncing: trainingSyncState.syncing,
    synced: trainingSyncState.synced,
    version: trainingSyncState.version
  });
  return () => {
    listeners.delete(listener);
  };
}
async function readStatus(owner: string) {
  const db = await openTrainingDb();
  try {
    const repo = createTrainingSyncRepository(db, owner);
    const [pending, rejected] = await Promise.all([repo.countPending(), repo.getFailures()]);
    return { pending, error: rejected[0]?.permanentError ?? null };
  } finally {
    db.close();
  }
}
async function refreshStatus(owner: string, generation: number) {
  const { pending, error } = await readStatus(owner);
  if (mounted && getAuthSession().generation === generation && getTrainingOwner() === owner)
    publish({
      pending,
      error: error ?? trainingSyncState.error,
      ...(pending > 0 ? { synced: false } : {})
    });
}

function scheduleRetry(error: unknown) {
  clearTimeout(timer);
  if (!mounted || !getTrainingOwner().startsWith('account:')) return;
  const delay = Math.max(
    error instanceof RequestTimeoutError ? REQUEST_TIMEOUT_MS : 0,
    error instanceof TrainingSyncError ? error.retryAfterMs : 0,
    Math.min(60_000, 1000 * 2 ** Math.min(failures++, 6))
  );
  timer = setTimeout(() => {
    void syncTrainingNow();
  }, delay);
}

/** Run one account's uploads and downloads under an origin-wide cooperative lock. */
export async function syncTrainingNow(): Promise<void> {
  if (!mounted || !getTrainingOwner().startsWith('account:') || !navigator.onLine) return;
  const session = getAuthSession();
  const owner = getTrainingOwner();
  if (inFlight?.generation === session.generation && inFlight.owner === owner) {
    inFlight.rerun = true;
    return inFlight.promise;
  }
  const signal = controller.signal;
  const current = () =>
    mounted && !signal.aborted && isAuthSessionCurrent(session) && getTrainingOwner() === owner;
  const entry = { owner, generation: session.generation, promise: Promise.resolve(), rerun: false };
  entry.promise = Promise.resolve().then(async () => {
    let error: string | null = null;
    let backoff: (() => void) | undefined;
    try {
      const run = async () => {
        if (!current()) return;
        const db = await openTrainingDb();
        try {
          const clientId = await getTrainingInstallationId(db);
          if (!current()) return;
          await synchronizeTraining({
            owner,
            clientId,
            repository: createTrainingSyncRepository(db, owner),
            isCurrent: current,
            request: (path, init) => {
              if (!current()) throw new DOMException('Training owner changed', 'AbortError');
              return requestTrainingData(owner, path, { ...init, signal });
            }
          });
        } finally {
          db.close();
        }
      };
      if (navigator.locks?.request)
        await navigator.locks.request(`ditpath:training:${owner}`, { signal }, run);
      else await run();
      if (current()) failures = 0;
    } catch (cause) {
      error = cause instanceof TrainingSyncError ? cause.code : 'TRAINING_SYNC_FAILED';
      if (!(cause instanceof TrainingSyncError && cause.permanent))
        backoff = () => scheduleRetry(cause);
    }

    const syncSucceeded = error === null;
    let pending = trainingSyncState.pending;
    if (current()) {
      try {
        const status = await readStatus(owner);
        pending = status.pending;
        error = status.error ?? error;
      } catch {
        error = 'TRAINING_STORAGE_FAILED';
      }
    }
    if (inFlight !== entry) return;
    inFlight = null;
    if (!current()) return;
    backoff?.();
    // An idle subscriber can retry immediately, including from inside publish().
    publish({ pending, error, synced: pending === 0 && error === null, syncing: false });
    if (entry.rerun && syncSucceeded && !inFlight && current()) void syncTrainingNow();
  });
  inFlight = entry;
  clearTimeout(timer);
  publish({ syncing: true });
  return entry.promise;
}

export async function getUnclaimedTrainingCount(): Promise<number> {
  const db = await openTrainingDb();
  try {
    return await createTrainingSyncRepository(db, getTrainingOwner()).getUnclaimedCount();
  } finally {
    db.close();
  }
}

/** Called only by the explicit account import action; old queues are never resubmitted. */
export async function importUnclaimedTraining(): Promise<number> {
  const owner = getTrainingOwner(),
    session = getAuthSession();
  if (!owner.startsWith('account:'))
    throw new Error('Training import requires a signed-in account');
  const db = await openTrainingDb();
  try {
    const installation = await getTrainingInstallationId(db);
    if (!isAuthSessionCurrent(session) || getTrainingOwner() !== owner)
      throw new DOMException('Training owner changed', 'AbortError');
    const count = await createTrainingSyncRepository(db, owner).importUnclaimed(installation);
    if (isAuthSessionCurrent(session)) void syncTrainingNow();
    return count;
  } finally {
    db.close();
  }
}

/** Browser resources are created only when the root layout mounts. */
export function initializeTrainingSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  mounts++;
  if (!disposeRuntime) {
    mounted = true;
    let authGeneration = -1;
    const authChanged = () => {
      const session = getAuthSession(),
        owner = getTrainingOwner();
      if (session.generation === authGeneration && owner === trainingSyncState.owner) return;
      authGeneration = session.generation;
      controller.abort();
      inFlight = null;
      controller = new AbortController();
      clearTimeout(timer);
      failures = 0;
      publish({
        owner,
        pending: 0,
        error: null,
        syncing: false,
        synced: false,
        version: trainingSyncState.version + 1
      });
      void refreshStatus(owner, session.generation).catch(() => {});
      void syncTrainingNow();
    };
    const unsubscribeUser = user.subscribe(authChanged);
    const unsubscribeEpoch = subscribeTrainingEpoch(authChanged);
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ditpath:training');
    const changed = (owner: string, pilot = false) => {
      if (owner !== getTrainingOwner()) return;
      publish({ version: trainingSyncState.version + 1, ...(pilot ? {} : { synced: false }) });
      if (!pilot) void refreshStatus(owner, getAuthSession().generation).catch(() => {});
    };
    const unsubscribeData = subscribeTrainingDataChanges(({ ownerKey, local, scope }) => {
      const pilot = scope === 'learning-pilot' || scope === 'learning-evidence';
      changed(ownerKey, pilot);
      channel?.postMessage({ owner: ownerKey, local, scope });
      if (!pilot && local && ownerKey === getTrainingOwner()) void syncTrainingNow();
    });
    if (channel)
      channel.onmessage = (event) => {
        if (event.data?.owner !== getTrainingOwner()) return;
        const pilot =
          event.data.scope === 'learning-pilot' || event.data.scope === 'learning-evidence';
        changed(event.data.owner, pilot);
        if (!pilot && event.data.local) void syncTrainingNow();
      };
    const wake = () => {
      if (document.visibilityState !== 'hidden') void syncTrainingNow();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    disposeRuntime = () => {
      mounted = false;
      controller.abort();
      clearTimeout(timer);
      unsubscribeUser();
      unsubscribeEpoch();
      unsubscribeData();
      channel?.close();
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }
  return () => {
    if (--mounts === 0) {
      disposeRuntime?.();
      disposeRuntime = null;
    }
  };
}

import { stopEvidenceAudio } from './audio/evidence-engine';
import { SvelteSet } from 'svelte/reactivity';
import { apiFetch, getAuthAccountId, getAuthSession, isAuthSessionCurrent, user } from './auth';
import { createLearningEvidenceRepository, openLearningEvidenceDb } from './data/learning-evidence';
import { subscribeTrainingDataChanges } from './data/training-data-events';
import { retainCaptureLease, recoverInterruptedEvidence } from './learning-evidence/recovery';
import { EvidenceSyncError, synchronizeLearningEvidence } from './learning-evidence/sync';
export interface LearningSyncSnapshot {
  owner: string;
  pending: number;
  /** Permanently rejected records retained locally for diagnosis. */
  rejected: number;
  /** Pending records whose permanently rejected dependency makes upload impossible. */
  blocked: number;
  /** The first pass for this owner has drained, so coverage is settled, not pending. */
  initialized: boolean;
  syncing: boolean;
  synced: boolean;
  unavailable: boolean;
  error: string | null;
  version: number;
  /** Increments only when evidence records or excluded rejections change. */
  dataVersion: number;
}
class State implements LearningSyncSnapshot {
  owner = $state('unclaimed');
  pending = $state(0);
  rejected = $state(0);
  blocked = $state(0);
  initialized = $state(false);
  syncing = $state(false);
  synced = $state(false);
  unavailable = $state(false);
  error = $state<string | null>(null);
  version = $state(0);
  dataVersion = $state(0);
}
export const learningSyncState = new State();
const listeners = new SvelteSet<(state: LearningSyncSnapshot) => void>();
const snapshot = (): LearningSyncSnapshot => ({
  owner: learningSyncState.owner,
  pending: learningSyncState.pending,
  rejected: learningSyncState.rejected,
  blocked: learningSyncState.blocked,
  initialized: learningSyncState.initialized,
  syncing: learningSyncState.syncing,
  synced: learningSyncState.synced,
  unavailable: learningSyncState.unavailable,
  error: learningSyncState.error,
  version: learningSyncState.version,
  dataVersion: learningSyncState.dataVersion
});
function publish(patch: Partial<LearningSyncSnapshot>) {
  Object.assign(learningSyncState, patch);
  for (const fn of listeners) fn(snapshot());
}
export function subscribeLearningSync(fn: (s: LearningSyncSnapshot) => void) {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}
const owner = () => (getAuthAccountId() ? `account:${getAuthAccountId()}` : 'unclaimed');
let mounted = false,
  running: Promise<void> | null = null,
  rerun = false,
  abort = new AbortController();
let retry: ReturnType<typeof setTimeout> | undefined;
async function refresh(expected: string) {
  let db: IDBDatabase | null = null;
  try {
    db = await openLearningEvidenceDb();
    const status = await createLearningEvidenceRepository(db, expected).getSyncStatus();
    if (mounted && owner() === expected) publish(status);
  } finally {
    db?.close();
  }
}
export async function syncLearningNow(options: { rerun?: boolean } = {}): Promise<void> {
  if (!mounted) return;
  if (running) {
    // Focus and visibilitychange describe the same wake-up. Coalesce them so a
    // background return does not run two download passes.
    if (options.rerun !== false) rerun = true;
    return running;
  }
  clearTimeout(retry);
  const expected = owner();
  const session = getAuthSession();
  const signal = abort.signal;
  const active = () =>
    mounted && !signal.aborted && owner() === expected && isAuthSessionCurrent(session);
  if (!expected.startsWith('account:') || !navigator.onLine) {
    await refresh(expected).catch(() => {});
    if (mounted && owner() === expected) publish({ initialized: true });
    return;
  }
  publish({ syncing: true, error: null, unavailable: false });
  running = (async () => {
    let db: IDBDatabase | null = null;
    try {
      db = await openLearningEvidenceDb();
      if (!active()) return;
      const repository = createLearningEvidenceRepository(db, expected);
      const synchronize = () =>
        synchronizeLearningEvidence({
          repository,
          isCurrent: active,
          request: (path, init) => apiFetch(path, { ...init, signal })
        });
      // One checkpoint writer per account across tabs; the protocol remains idempotent
      // on browsers without Web Locks.
      if (navigator.locks)
        await navigator.locks.request(`opencw-learning-sync:${expected}`, { signal }, async () => {
          if (active()) await synchronize();
        });
      else await synchronize();
      if (active()) {
        const status = await createLearningEvidenceRepository(db, expected).getSyncStatus();
        publish({ ...status, synced: status.pending === 0 });
      }
    } catch (error) {
      if (active()) {
        const unavailable = error instanceof EvidenceSyncError && error.unavailable;
        publish({
          synced: false,
          unavailable,
          error: error instanceof Error ? error.message : 'LEARNING_SYNC_FAILED'
        });
        if (!unavailable)
          retry = setTimeout(
            () => void syncLearningNow(),
            Math.max(15000, error instanceof EvidenceSyncError ? error.retryAfterMs : 0)
          );
      }
    } finally {
      db?.close();
      if (active()) publish({ syncing: false });
    }
  })();
  try {
    await running;
  } finally {
    running = null;
    const again = rerun;
    rerun = false;
    if (again && mounted && !learningSyncState.unavailable) {
      // A queued rerun is still part of the initial settle; keep coverage pending.
      void syncLearningNow();
    } else if (mounted && owner() === expected) publish({ initialized: true });
  }
}
/** Explicit, captured-account import; signing in never calls this action. */
export async function importGuestLearningEvidence(): Promise<number> {
  const expected = owner(),
    session = getAuthSession();
  if (!expected.startsWith('account:')) throw new Error('Evidence import requires an account');
  const db = await openLearningEvidenceDb();
  try {
    return await createLearningEvidenceRepository(db, expected).importUnclaimed(
      () => owner() === expected && isAuthSessionCurrent(session)
    );
  } finally {
    db.close();
  }
}
export async function getGuestEvidenceImportStatus() {
  const db = await openLearningEvidenceDb();
  try {
    return await createLearningEvidenceRepository(db, owner()).getImportStatus();
  } finally {
    db.close();
  }
}
export function initializeLearningSync(): () => void {
  if (typeof window === 'undefined' || mounted) return () => {};
  mounted = true;
  const releaseCapture = retainCaptureLease();
  let generation = -1;
  const auth = user.subscribe(() => {
    const expected = owner();
    const currentGeneration = getAuthSession().generation;
    if (expected === learningSyncState.owner && generation === currentGeneration) return;
    generation = currentGeneration;
    if (expected !== learningSyncState.owner) void stopEvidenceAudio();
    abort.abort();
    abort = new AbortController();
    clearTimeout(retry);
    publish({
      owner: expected,
      pending: 0,
      rejected: 0,
      blocked: 0,
      initialized: false,
      syncing: false,
      synced: false,
      error: null,
      unavailable: false,
      version: learningSyncState.version + 1,
      dataVersion: 0
    });
    void syncLearningNow();
  });
  const channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('opencw:learning-evidence');
  const changed = (expected: string, local = false, records = false) => {
    if (expected !== owner()) return;
    publish({
      version: learningSyncState.version + 1,
      dataVersion: learningSyncState.dataVersion + (records ? 1 : 0),
      ...(local ? { synced: false } : {})
    });
    void refresh(expected).catch(() => {});
    if (local && !learningSyncState.unavailable) {
      if (running) rerun = true;
      else void syncLearningNow();
    }
  };
  const data = subscribeTrainingDataChanges(({ ownerKey, scope, local, records }) => {
    if (scope !== 'learning-evidence') return;
    changed(ownerKey, local, records === true);
    channel?.postMessage({ owner: ownerKey, local, records: records === true });
  });
  if (channel)
    channel.onmessage = (event) =>
      changed(String(event.data?.owner), event.data?.local === true, event.data?.records === true);
  const wake = () => {
    if (document.visibilityState !== 'hidden') void syncLearningNow({ rerun: false });
  };
  const reconnect = () => {
    if (document.visibilityState !== 'hidden') void syncLearningNow();
  };
  const offline = () => publish({ synced: false });
  window.addEventListener('offline', offline);
  window.addEventListener('online', reconnect);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
  const recoveryOwner = owner();
  // Recovery appends notify the evidence repository, which starts or queues the
  // upload pass; do not queue a second one here.
  void recoverInterruptedEvidence(recoveryOwner, () => mounted && owner() === recoveryOwner).catch(
    () => {}
  );
  return () => {
    mounted = false;
    releaseCapture();
    abort.abort();
    clearTimeout(retry);
    auth();
    data();
    channel?.close();
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', reconnect);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}

/** Coverage is evidence-ledger state, independent of legacy training synchronization. */
export function learningEvidenceCoverage(
  expectedOwner: string
): 'complete' | 'local-only' | 'partial' {
  if (!expectedOwner.startsWith('account:')) return 'local-only';
  return (typeof navigator === 'undefined' || navigator.onLine) &&
    learningSyncState.owner === expectedOwner &&
    learningSyncState.synced &&
    !learningSyncState.syncing &&
    learningSyncState.pending === 0 &&
    !learningSyncState.error &&
    !learningSyncState.unavailable
    ? 'complete'
    : 'partial';
}

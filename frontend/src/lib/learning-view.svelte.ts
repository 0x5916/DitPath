import { loadLearningSnapshot, type LearningSnapshot } from './data/learning-snapshot';
import {
  learningEvidenceCoverage,
  learningSyncState,
  subscribeLearningSync
} from './learning-sync.svelte';
import { getTrainingOwner, subscribeTrainingSync } from './training-sync.svelte';
/** Mounted pages share the same projection and owner fence. No browser work during prerender. */
export function createLearningView() {
  let snapshot = $state.raw<LearningSnapshot | null>(null);
  let failed = $state(false);
  let settled = $state(false);
  let active = false,
    generation = 0;
  async function refresh(force = false) {
    const ownerKey = getTrainingOwner(),
      request = ++generation;
    if (snapshot?.ownerKey !== ownerKey) {
      snapshot = null;
      settled = false;
    }
    const previousCoverage = snapshot?.coverage;
    try {
      const result = await loadLearningSnapshot({
        ownerKey,
        // A forced refresh during a pending pass re-projects changed inputs
        // without letting transient coverage alone change the action.
        coverage:
          force && settled && learningSyncState.syncing && previousCoverage
            ? previousCoverage
            : learningEvidenceCoverage(ownerKey)
      });
      if (active && request === generation && getTrainingOwner() === ownerKey) {
        const initialPending =
          ownerKey.startsWith('account:') &&
          (learningSyncState.owner !== ownerKey || !learningSyncState.initialized);
        const syncPending = ownerKey.startsWith('account:') && learningSyncState.syncing;
        // A transient partial read must not replace a settled projection. A real
        // input change forces the new projection so stale claims cannot linger;
        // after initialization it stays actionable even while sync is pending.
        if (!settled || force) {
          snapshot = result;
          settled = !initialPending;
        } else if (!initialPending && !syncPending) {
          snapshot = result;
          settled = true;
        }
        failed = false;
      }
    } catch {
      if (active && request === generation) failed = true;
    }
  }
  return {
    get snapshot() {
      return snapshot;
    },
    get failed() {
      return failed;
    },
    /** The visible snapshot reflects settled initial coverage or a forced input refresh. */
    get settled() {
      return settled;
    },
    refresh,
    start() {
      active = true;
      let trainingRevision = '';
      let learningRevision = '';
      let learningCoverage = '';
      let dataChanged = false;
      let scheduled = false;
      let forceRefresh = false;
      const schedule = (force = false) => {
        forceRefresh ||= force;
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          const force = forceRefresh;
          forceRefresh = false;
          if (active) void refresh(force);
        });
      };
      const training = subscribeTrainingSync((state) => {
        const next = `${state.owner}:${state.version}`;
        if (next === trainingRevision) return;
        trainingRevision = next;
        // A version change means attempts, sessions, or evidence changed.
        schedule(true);
      });
      const learning = subscribeLearningSync((state) => {
        const revision = `${state.owner}:${state.version}`;
        const coverage = `${state.owner}:${state.initialized}:${state.synced}:${state.pending}:${state.error ?? ''}:${state.unavailable}:${state.syncing}`;
        if (revision === learningRevision && coverage === learningCoverage) return;
        if (revision !== learningRevision) dataChanged = true;
        learningRevision = revision;
        learningCoverage = coverage;
        // Wait for the sync pass to settle so the projection sees its final
        // coverage instead of refreshing once as partial and again as complete.
        if (!state.syncing) {
          const force = dataChanged;
          dataChanged = false;
          schedule(force);
        }
      });
      // A sync pass publishes partial coverage while it runs. Let its settle
      // notification refresh the projection instead of replacing a resolved one.
      const wake = () => {
        if (!learningSyncState.syncing) schedule();
      };
      window.addEventListener('focus', wake);
      return () => {
        active = false;
        generation++;
        training();
        learning();
        window.removeEventListener('focus', wake);
      };
    }
  };
}

import { loadLearningSnapshot, type LearningSnapshot } from './data/learning-snapshot';
import { learningEvidenceCoverage, subscribeLearningSync } from './learning-sync.svelte';
import { getTrainingOwner, subscribeTrainingSync } from './training-sync.svelte';
/** Mounted pages share the same projection and owner fence. No browser work during prerender. */
export function createLearningView() {
  let snapshot = $state.raw<LearningSnapshot | null>(null);
  let failed = $state(false);
  let active = false,
    generation = 0;
  async function refresh() {
    const ownerKey = getTrainingOwner(),
      request = ++generation;
    if (snapshot?.ownerKey !== ownerKey) snapshot = null;
    try {
      const result = await loadLearningSnapshot({
        ownerKey,
        coverage: learningEvidenceCoverage(ownerKey)
      });
      if (active && request === generation && getTrainingOwner() === ownerKey) {
        snapshot = result;
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
    refresh,
    start() {
      active = true;
      const training = subscribeTrainingSync(() => void refresh());
      const learning = subscribeLearningSync(() => void refresh());
      const wake = () => void refresh();
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

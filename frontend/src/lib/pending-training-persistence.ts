/** Failed local writes keep their captured repositories until they commit or the page unloads. */
export interface PendingTrainingPersistence {
  key: object;
  owner: string;
  save(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export function createPendingTrainingPersistenceManager() {
  const finished = new WeakSet<object>();
  const pending = new Map<
    object,
    { work: PendingTrainingPersistence; retry: number; initial: Promise<boolean> }
  >();
  async function attempt(entry: {
    work: PendingTrainingPersistence;
    retry: number;
  }): Promise<boolean> {
    let saved = false;
    try {
      saved = await entry.work.save();
    } catch (error) {
      console.error('Training history save remains pending:', error);
    }
    if (!saved) {
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(entry.retry++, 6));
      setTimeout(() => {
        void attempt(entry);
      }, delay);
      return false;
    }
    try {
      await entry.work.cleanup();
    } catch (error) {
      console.error('Saved training session cleanup failed:', error);
    } finally {
      finished.add(entry.work.key);
      pending.delete(entry.work.key);
    }
    return true;
  }
  return {
    retain(work: PendingTrainingPersistence): Promise<boolean> {
      if (finished.has(work.key)) return Promise.resolve(true);
      const existing = pending.get(work.key);
      if (existing) return existing.initial;
      const entry = { work, retry: 0, initial: Promise.resolve(false) };
      pending.set(work.key, entry);
      entry.initial = attempt(entry);
      return entry.initial;
    },
    hasPending(): boolean {
      return pending.size > 0;
    }
  };
}

const applicationPersistence = createPendingTrainingPersistenceManager();
export const retainTrainingPersistence = applicationPersistence.retain;
export const hasPendingTrainingPersistence = applicationPersistence.hasPending;

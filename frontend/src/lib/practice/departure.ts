/** A confirmed departure waits for a cancelled Back/Forward traversal to settle. */
export function createPracticeDeparture(
  restored: Promise<void>,
  resume: () => void | Promise<void>,
  isActive: () => boolean = () => true
) {
  let cancelled = false;
  let completed = false;
  let pending: Promise<boolean> | null = null;
  return {
    cancel() {
      cancelled = true;
    },
    confirm(): Promise<boolean> {
      if (pending) return pending;
      if (cancelled || completed) return Promise.resolve(false);
      pending = (async () => {
        await restored;
        if (cancelled || !isActive()) return false;
        await resume();
        completed = true;
        return true;
      })().finally(() => {
        pending = null;
      });
      return pending;
    }
  };
}

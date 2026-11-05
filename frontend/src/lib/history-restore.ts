export interface HistoryRestore {
  /** Resolves when the browser has restored `sourceHref`, or when cancelled. */
  promise: Promise<void>;
  cancel(): void;
}

/**
 * Wait for a cancelled Back/Forward traversal to restore the current page.
 * `cancel()` settles the promise so a page being torn down cannot hang.
 */
export function waitForHistoryRestore(sourceHref: string): HistoryRestore {
  if (window.location.href === sourceHref) {
    return { promise: Promise.resolve(), cancel: () => {} };
  }

  let finish = () => {};
  const promise = new Promise<void>((resolve) => {
    const onPop = () => {
      if (window.location.href === sourceHref) finish();
    };
    finish = () => {
      window.removeEventListener('popstate', onPop);
      resolve();
    };
    window.addEventListener('popstate', onPop);
  });

  return { promise, cancel: finish };
}

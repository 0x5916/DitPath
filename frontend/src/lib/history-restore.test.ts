import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForHistoryRestore } from './history-restore';

function stubWindow(href: string) {
  const events = new EventTarget();
  const location = { href };
  vi.stubGlobal('window', {
    location,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events)
  });
  return { events, location };
}

afterEach(() => vi.unstubAllGlobals());

describe('waitForHistoryRestore', () => {
  const source = 'https://example.test/morse/learn/session';

  it('resolves immediately when the page is already restored', async () => {
    stubWindow(source);
    await expect(waitForHistoryRestore(source).promise).resolves.toBeUndefined();
  });

  it('waits for a popstate that restores the source URL', async () => {
    const { events, location } = stubWindow('https://example.test/elsewhere');
    const restore = waitForHistoryRestore(source);
    let settled = false;
    void restore.promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    location.href = source;
    events.dispatchEvent(new Event('popstate'));
    await expect(restore.promise).resolves.toBeUndefined();
  });

  it('settles when cancelled so teardown cannot hang', async () => {
    stubWindow('https://example.test/elsewhere');
    const restore = waitForHistoryRestore(source);
    restore.cancel();
    await expect(restore.promise).resolves.toBeUndefined();
  });
});

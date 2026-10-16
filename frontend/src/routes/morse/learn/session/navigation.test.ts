import { describe, expect, it, vi } from 'vitest';
import { saveBeforeSessionNavigation } from './navigation';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('guided session navigation recovery', () => {
  it('keeps the failed save queue mounted and resumes the intended internal destination after retry', async () => {
    const controller = { abandon: vi.fn(), flushPersistence: vi.fn().mockResolvedValue(false) };
    const goto = vi.fn();
    const pending = { restored: Promise.resolve(), resume: () => goto('/morse/progress') };
    expect(await saveBeforeSessionNavigation(controller, pending)).toBe(false);
    expect(goto).not.toHaveBeenCalled();
    vi.mocked(controller.flushPersistence).mockResolvedValue(true);
    expect(await saveBeforeSessionNavigation(controller, pending)).toBe(true);
    expect(goto).toHaveBeenCalledExactlyOnceWith('/morse/progress');
  });

  it('waits for commit and cancelled history restoration before replaying the exact Back delta', async () => {
    const commit = deferred();
    const restore = deferred();
    const historyGo = vi.fn();
    const controller = {
      abandon: vi.fn(),
      flushPersistence: vi.fn(async () => {
        await commit.promise;
        return true;
      })
    };
    const navigating = saveBeforeSessionNavigation(controller, {
      restored: restore.promise,
      resume: () => historyGo(-2)
    });
    expect(historyGo).not.toHaveBeenCalled();
    commit.resolve();
    await Promise.resolve();
    expect(historyGo).not.toHaveBeenCalled();
    restore.resolve();
    expect(await navigating).toBe(true);
    expect(historyGo).toHaveBeenCalledExactlyOnceWith(-2);
  });

  it('permits explicit discard without reattempting a failed write and preserves Forward intent', async () => {
    const controller = { abandon: vi.fn(), flushPersistence: vi.fn().mockResolvedValue(false) };
    const historyGo = vi.fn();
    expect(
      await saveBeforeSessionNavigation(
        controller,
        {
          restored: Promise.resolve(),
          resume: () => historyGo(1)
        },
        { discard: true }
      )
    ).toBe(true);
    expect(controller.flushPersistence).not.toHaveBeenCalled();
    expect(historyGo).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('does not trigger a stale navigation after the page was destroyed while saving', async () => {
    const commit = deferred();
    const controller = {
      abandon: vi.fn(),
      flushPersistence: vi.fn(async () => {
        await commit.promise;
        return true;
      })
    };
    const resume = vi.fn();
    let active = true;
    const navigating = saveBeforeSessionNavigation(
      controller,
      {
        restored: Promise.resolve(),
        resume
      },
      { isActive: () => active }
    );
    active = false;
    commit.resolve();
    expect(await navigating).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });
});

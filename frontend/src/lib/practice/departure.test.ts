import { describe, expect, it, vi } from 'vitest';
import { createPracticeDeparture } from './departure';

describe('practice departure', () => {
  it('restores history before resuming and ignores repeated confirmation', async () => {
    let restored!: () => void;
    const ready = new Promise<void>((resolve) => {
      restored = resolve;
    });
    const resume = vi.fn();
    const departure = createPracticeDeparture(ready, resume);
    const first = departure.confirm();
    const repeated = departure.confirm();
    expect(resume).not.toHaveBeenCalled();
    restored();
    expect(await first).toBe(true);
    await repeated;
    expect(await departure.confirm()).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });
  it('cancellation while history restores keeps the copy on the page', async () => {
    let restored!: () => void;
    const resume = vi.fn();
    const departure = createPracticeDeparture(
      new Promise<void>((resolve) => {
        restored = resolve;
      }),
      resume
    );
    const pending = departure.confirm();
    departure.cancel();
    restored();
    expect(await pending).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });
  it('does not navigate after the owner or component changes', async () => {
    const resume = vi.fn();
    const departure = createPracticeDeparture(Promise.resolve(), resume, () => false);
    expect(await departure.confirm()).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  });
  it('allows retry if navigation fails without discarding the queued choice', async () => {
    const resume = vi
      .fn()
      .mockRejectedValueOnce(new Error('navigation failed'))
      .mockResolvedValue(undefined);
    const departure = createPracticeDeparture(Promise.resolve(), resume);
    await expect(departure.confirm()).rejects.toThrow('navigation failed');
    expect(await departure.confirm()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(2);
  });
});

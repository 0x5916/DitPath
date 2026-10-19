import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPendingTrainingPersistenceManager } from './pending-training-persistence';

afterEach(() => {
  vi.useRealTimers();
});

describe('pending training persistence', () => {
  it('retains original owner writes after route ownership changes and cleans up only after commit', async () => {
    vi.useFakeTimers();
    const manager = createPendingTrainingPersistenceManager();
    const capturedOwner = 'account:A';
    let visibleOwner = capturedOwner;
    let storageAvailable = false;
    const savedOwners: string[] = [];
    const cleanup = vi.fn(async () => {});
    const save = vi.fn(async () => {
      if (!storageAvailable) return false;
      savedOwners.push(capturedOwner);
      return true;
    });
    const key = {};
    expect(await manager.retain({ key, owner: capturedOwner, save, cleanup })).toBe(false);
    expect(visibleOwner).toBe(capturedOwner);
    visibleOwner = 'account:B';
    expect(manager.hasPending()).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    storageAvailable = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(visibleOwner).toBe('account:B');
    expect(savedOwners).toEqual(['account:A']);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(manager.hasPending()).toBe(false);
    expect(await manager.retain({ key, owner: capturedOwner, save, cleanup })).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('retains repeated failures and deduplicates the same controller instead of dropping its queue', async () => {
    vi.useFakeTimers();
    const manager = createPendingTrainingPersistenceManager();
    const work = {
      key: {},
      owner: 'account:A',
      save: vi.fn(async () => false),
      cleanup: vi.fn(async () => {})
    };
    expect(await manager.retain(work)).toBe(false);
    expect(await manager.retain(work)).toBe(false);
    expect(work.save).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(127_000);
    expect(manager.hasPending()).toBe(true);
    expect(work.save).toHaveBeenCalledTimes(8);
    expect(work.cleanup).not.toHaveBeenCalled();
    vi.clearAllTimers();
  });
});

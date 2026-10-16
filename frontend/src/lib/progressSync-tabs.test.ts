import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '#lib/storageKeys.ts';

const api = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('#lib/api.ts', () => ({ submitProgress: api.submit }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createLocks() {
  const pending = new Map<string, Promise<void>>();
  return {
    request: vi.fn((name: string, callback: () => unknown) => {
      const previous = pending.get(name) ?? Promise.resolve();
      const result = previous.then(callback);
      pending.set(
        name,
        result.then(
          () => undefined,
          () => undefined
        )
      );
      return result;
    })
  };
}

beforeEach(() => {
  vi.resetModules();
  api.submit.mockReset().mockResolvedValue(undefined);
  const values = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('progress uploads across independent tabs', () => {
  it('has one uploader while allowing another tab to enqueue during its network wait', async () => {
    const locks = createLocks();
    const network = { onLine: false, locks };
    vi.stubGlobal('navigator', network);
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-alice');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    const first = await import('#lib/progressSync.ts');
    vi.resetModules();
    const second = await import('#lib/progressSync.ts');
    expect(first).not.toBe(second);
    await first.saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0.5 });

    const upload = deferred();
    api.submit.mockReturnValueOnce(upload.promise);
    network.onLine = true;
    const firstFlush = first.flushQueuedProgress();
    const secondFlush = second.flushQueuedProgress();
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(locks.request.mock.calls.filter(([name]) => name.endsWith(':upload'))).toHaveLength(2);

    const save = second.saveProgressOfflineFirst({
      lesson: 2,
      char_wpm: 20,
      eff_wpm: 10,
      accuracy: 0.6
    });
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(CW_STORAGE_KEYS.progressQueue)!)).toHaveLength(2)
    );
    expect(api.submit).toHaveBeenCalledTimes(1);
    upload.resolve();
    await Promise.all([firstFlush, secondFlush, save]);
    expect(api.submit.mock.calls.map(([lesson]) => lesson)).toEqual([1, 2]);
    expect(localStorage.getItem(CW_STORAGE_KEYS.progressQueue)).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('#lib/api.ts', () => ({
  submitProgress: vi.fn()
}));

import { submitProgress } from '#lib/api.ts';
import {
  createProgressRecorder,
  flushQueuedProgress,
  getLocalProgressRecords,
  saveProgressOfflineFirst
} from '#lib/progressSync.ts';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '#lib/storageKeys.ts';

const submitProgressMock = submitProgress as unknown as Mock;

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    }
  };
}

function readQueue(): Array<Record<string, unknown>> {
  const raw = globalThis.localStorage.getItem(CW_STORAGE_KEYS.progressQueue);
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', createMemoryStorage());
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('navigator', { onLine: true });
  submitProgressMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveProgressOfflineFirst', () => {
  it('uploads directly when authenticated and online, with the current payload shape', async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');

    await saveProgressOfflineFirst({ lesson: 3, char_wpm: 22, eff_wpm: 12, accuracy: 0.875 });

    expect(submitProgressMock).toHaveBeenCalledTimes(1);
    expect(submitProgressMock).toHaveBeenCalledWith(
      3,
      22,
      12,
      0.875,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
    expect(readQueue()).toEqual([]);
  });

  it('records zero-accuracy completed attempts', async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');

    await saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0 });

    expect(submitProgressMock).toHaveBeenCalledWith(
      1,
      20,
      10,
      0,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it('queues the record in localStorage when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });

    await saveProgressOfflineFirst({ lesson: 5, char_wpm: 25, eff_wpm: 15, accuracy: 0.5 });

    expect(submitProgressMock).not.toHaveBeenCalled();
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ lesson: 5, char_wpm: 25, eff_wpm: 15, accuracy: 0.5 });
    expect(typeof queue[0].queued_at).toBe('string');
    expect(typeof queue[0].client_created_at).toBe('string');
  });

  it('queues the record when the upload fails', async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');
    submitProgressMock.mockRejectedValueOnce(new Error('network down'));

    await saveProgressOfflineFirst({ lesson: 2, char_wpm: 20, eff_wpm: 10, accuracy: 0.9 });

    expect(readQueue()).toHaveLength(1);
  });

  it('keeps guest records locally and exposes them through getLocalProgressRecords', async () => {
    await saveProgressOfflineFirst({ lesson: 4, char_wpm: 20, eff_wpm: 10, accuracy: 0.8 });

    const records = getLocalProgressRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      lesson: '4',
      char_wpm: 20,
      eff_wpm: 10,
      accuracy: 0.8
    });
    expect(records[0].client_created_at).toBe(records[0].created_at);
  });
});

describe('flushQueuedProgress retry behavior', () => {
  it('uploads queued records and clears the queue on success', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveProgressOfflineFirst({ lesson: 6, char_wpm: 18, eff_wpm: 9, accuracy: 0.6 });
    expect(readQueue()).toHaveLength(1);

    vi.stubGlobal('navigator', { onLine: true });
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');

    await flushQueuedProgress();

    expect(submitProgressMock).toHaveBeenCalledTimes(1);
    expect(submitProgressMock).toHaveBeenCalledWith(
      6,
      18,
      9,
      0.6,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
    expect(readQueue()).toEqual([]);
  });

  it('keeps failed records queued for a later retry', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveProgressOfflineFirst({ lesson: 6, char_wpm: 18, eff_wpm: 9, accuracy: 0.6 });

    vi.stubGlobal('navigator', { onLine: true });
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');
    submitProgressMock.mockRejectedValueOnce(new Error('still offline'));

    await flushQueuedProgress();
    expect(readQueue()).toHaveLength(1);

    submitProgressMock.mockResolvedValueOnce(undefined);
    await flushQueuedProgress();
    expect(readQueue()).toEqual([]);
    expect(submitProgressMock).toHaveBeenCalledTimes(2);
  });

  it('does not attempt to upload without an access token', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveProgressOfflineFirst({ lesson: 7, char_wpm: 20, eff_wpm: 10, accuracy: 0.7 });

    vi.stubGlobal('navigator', { onLine: true });
    await flushQueuedProgress();

    expect(submitProgressMock).not.toHaveBeenCalled();
    expect(readQueue()).toHaveLength(1);
  });
});

describe('createProgressRecorder', () => {
  it('maps a typed attempt result onto the existing payload', async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    const recorder = createProgressRecorder();

    await recorder.record({
      lesson: 3,
      charWpm: 22,
      effWpm: 11,
      accuracy: 0.625,
      completedAt: '2026-01-02T03:04:05.000Z'
    });

    expect(submitProgressMock).toHaveBeenCalledWith(3, 22, 11, 0.625, '2026-01-02T03:04:05.000Z');
    expect(readQueue()).toEqual([]);
  });

  it('queues guest attempts with their completion time, without touching the API', async () => {
    const recorder = createProgressRecorder();

    await recorder.record({
      lesson: 4,
      charWpm: 20,
      effWpm: 10,
      accuracy: 0,
      completedAt: '2026-01-02T03:04:05.000Z'
    });

    expect(submitProgressMock).not.toHaveBeenCalled();
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      lesson: 4,
      accuracy: 0,
      client_created_at: '2026-01-02T03:04:05.000Z'
    });
  });
});

function deferredUpload() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('progress queue concurrency', () => {
  it('retains and uploads records appended while an earlier upload is pending', async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-1');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    const firstUpload = deferredUpload();
    submitProgressMock.mockReturnValueOnce(firstUpload.promise);
    const first = saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0.5 });
    const second = saveProgressOfflineFirst({
      lesson: 2,
      char_wpm: 20,
      eff_wpm: 10,
      accuracy: 0.6
    });
    expect(readQueue()).toHaveLength(2);
    firstUpload.resolve();
    await Promise.all([first, second]);
    expect(submitProgressMock).toHaveBeenCalledTimes(2);
    expect(submitProgressMock.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect(readQueue()).toEqual([]);
  });

  it('stops an old flush at account transition and keeps original ownership', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0.5 });
    await saveProgressOfflineFirst({ lesson: 2, char_wpm: 20, eff_wpm: 10, accuracy: 0.6 });
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-alice');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    vi.stubGlobal('navigator', { onLine: true });
    const pending = deferredUpload();
    submitProgressMock.mockReturnValueOnce(pending.promise);
    const oldFlush = flushQueuedProgress();
    await vi.waitFor(() => expect(submitProgressMock).toHaveBeenCalledTimes(1));
    expect(readQueue().map((entry) => entry.username)).toEqual(['alice', 'alice']);

    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-bob');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'bob');
    await saveProgressOfflineFirst({ lesson: 3, char_wpm: 20, eff_wpm: 10, accuracy: 0.7 });
    pending.resolve();
    await oldFlush;
    expect(submitProgressMock.mock.calls.map((call) => call[0])).toEqual([1, 3]);
    expect(readQueue().map((entry) => [entry.lesson, entry.username])).toEqual([
      [1, 'alice'],
      [2, 'alice']
    ]);
  });

  it('does not claim a failed guest upload for a later account', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveProgressOfflineFirst({ lesson: 4, char_wpm: 20, eff_wpm: 10, accuracy: 0.5 });
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-alice');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    vi.stubGlobal('navigator', { onLine: true });
    submitProgressMock.mockRejectedValueOnce(new Error('network unavailable'));
    await flushQueuedProgress();
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-bob');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'bob');
    await flushQueuedProgress();
    expect(submitProgressMock).toHaveBeenCalledTimes(1);
    expect(readQueue()[0].username).toBe('alice');
  });

  it('safely ignores recording without browser storage', async () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', undefined);
    await expect(
      saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0 })
    ).resolves.toBeUndefined();
    expect(submitProgressMock).not.toHaveBeenCalled();
  });
});

describe('progress queue Web Locks', () => {
  it('reads the latest queue only after the storage lock becomes available', async () => {
    const waiting = deferredUpload();
    const request = vi.fn(async (_name: string, mutate: () => unknown) => {
      await waiting.promise;
      return mutate();
    });
    vi.stubGlobal('navigator', { onLine: false, locks: { request } });
    const save = saveProgressOfflineFirst({ lesson: 2, char_wpm: 20, eff_wpm: 10, accuracy: 0.6 });
    expect(request).toHaveBeenCalledWith(
      `ditpath:${CW_STORAGE_KEYS.progressQueue}`,
      expect.any(Function)
    );
    expect(readQueue()).toEqual([]);
    // A cooperating tab finishes its write while this tab waits for the lock.
    localStorage.setItem(
      CW_STORAGE_KEYS.progressQueue,
      JSON.stringify([
        {
          id: 'other-tab',
          lesson: 1,
          char_wpm: 20,
          eff_wpm: 10,
          accuracy: 0.5,
          client_created_at: '2026-01-01T00:00:00Z',
          queued_at: '2026-01-01T00:00:00Z'
        }
      ])
    );
    waiting.resolve();
    await save;
    expect(readQueue().map((entry) => entry.lesson)).toEqual([1, 2]);
  });

  it('releases the storage lock before waiting for an upload', async () => {
    const locked = new Set<string>();
    const request = vi.fn(async (name: string, mutate: () => unknown) => {
      expect(locked.has(name)).toBe(false);
      locked.add(name);
      try {
        return await mutate();
      } finally {
        locked.delete(name);
      }
    });
    vi.stubGlobal('navigator', { onLine: true, locks: { request } });
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-alice');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    const pending = deferredUpload();
    submitProgressMock.mockImplementationOnce(() => {
      expect(locked.has(`ditpath:${CW_STORAGE_KEYS.progressQueue}`)).toBe(false);
      return pending.promise;
    });
    const first = saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0.5 });
    await vi.waitFor(() => expect(submitProgressMock).toHaveBeenCalledTimes(1));
    const second = saveProgressOfflineFirst({
      lesson: 2,
      char_wpm: 20,
      eff_wpm: 10,
      accuracy: 0.6
    });
    await vi.waitFor(() => expect(readQueue()).toHaveLength(2));
    pending.resolve();
    await Promise.all([first, second]);
    expect(submitProgressMock).toHaveBeenCalledTimes(2);
    expect(readQueue()).toEqual([]);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('does not claim guest records if the account changes while waiting for a lock', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await saveProgressOfflineFirst({ lesson: 1, char_wpm: 20, eff_wpm: 10, accuracy: 0.5 });
    const waiting = deferredUpload();
    const request = vi.fn(async (_name: string, mutate: () => unknown) => {
      await waiting.promise;
      return mutate();
    });
    vi.stubGlobal('navigator', { onLine: true, locks: { request } });
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-alice');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'alice');
    const flush = flushQueuedProgress();
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'token-bob');
    localStorage.setItem(AUTH_STORAGE_KEYS.username, 'bob');
    waiting.resolve();
    await flush;
    expect(readQueue()[0].username).toBeUndefined();
    expect(submitProgressMock).not.toHaveBeenCalled();
  });
});

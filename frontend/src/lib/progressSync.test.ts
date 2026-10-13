import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('$lib/api', () => ({
  submitProgress: vi.fn()
}));

import { submitProgress } from '$lib/api';
import {
  createProgressRecorder,
  flushQueuedProgress,
  getLocalProgressRecords,
  saveProgressOfflineFirst
} from '$lib/progressSync';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '$lib/storageKeys';

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

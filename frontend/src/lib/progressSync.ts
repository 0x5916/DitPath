import { submitProgress } from '$lib/api';
import type { ProgressRecord } from '$lib/api';
import type { AttemptResult, ResultRecorder } from '$lib/training/result';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '$lib/storageKeys';

type ProgressPayload = {
  lesson: number;
  char_wpm: number;
  eff_wpm: number;
  accuracy: number;
  client_created_at: string;
  username?: string;
  queued_at: string;
};

const MAX_QUEUE_SIZE = 500;

let syncInitialized = false;
let flushInFlight: Promise<void> | null = null;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readQueue(): ProgressPayload[] {
  if (!canUseStorage()) return [];

  const raw = localStorage.getItem(CW_STORAGE_KEYS.progressQueue);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is ProgressPayload => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;

      return (
        typeof value.lesson === 'number' &&
        typeof value.char_wpm === 'number' &&
        typeof value.eff_wpm === 'number' &&
        typeof value.accuracy === 'number' &&
        typeof value.client_created_at === 'string' &&
        typeof value.queued_at === 'string' &&
        (value.username === undefined || typeof value.username === 'string')
      );
    });
  } catch {
    return [];
  }
}

function writeQueue(queue: ProgressPayload[]): void {
  if (!canUseStorage()) return;

  if (queue.length === 0) {
    localStorage.removeItem(CW_STORAGE_KEYS.progressQueue);
    return;
  }

  localStorage.setItem(CW_STORAGE_KEYS.progressQueue, JSON.stringify(queue));
}

function enqueue(item: ProgressPayload): void {
  const queue = readQueue();
  queue.push(item);

  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }

  writeQueue(queue);
}

function shouldAttemptUpload(): boolean {
  if (!canUseStorage()) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  return Boolean(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken));
}

function sortQueue(queue: ProgressPayload[]): ProgressPayload[] {
  return [...queue].sort((a, b) => {
    const clientA = Date.parse(a.client_created_at);
    const clientB = Date.parse(b.client_created_at);

    if (!Number.isNaN(clientA) && !Number.isNaN(clientB) && clientA !== clientB) {
      return clientA - clientB;
    }

    const queuedA = Date.parse(a.queued_at);
    const queuedB = Date.parse(b.queued_at);

    if (!Number.isNaN(queuedA) && !Number.isNaN(queuedB) && queuedA !== queuedB) {
      return queuedA - queuedB;
    }

    return 0;
  });
}

export function getLocalProgressRecords(): ProgressRecord[] {
  const currentUsername = canUseStorage()
    ? (localStorage.getItem(AUTH_STORAGE_KEYS.username) ?? undefined)
    : undefined;

  return sortQueue(readQueue())
    .filter((item) => {
      if (currentUsername) {
        return item.username === undefined || item.username === currentUsername;
      }

      return item.username === undefined;
    })
    .map((item) => ({
      lesson: String(item.lesson),
      char_wpm: item.char_wpm,
      eff_wpm: item.eff_wpm,
      accuracy: item.accuracy,
      created_at: item.client_created_at,
      client_created_at: item.client_created_at
    }));
}

export async function flushQueuedProgress(): Promise<void> {
  if (!canUseStorage() || !shouldAttemptUpload()) return;

  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async () => {
    const currentUsername = localStorage.getItem(AUTH_STORAGE_KEYS.username) ?? undefined;
    const originalQueue = sortQueue(readQueue());
    if (originalQueue.length === 0) return;

    const remaining: ProgressPayload[] = [];

    for (let index = 0; index < originalQueue.length; index += 1) {
      const item = originalQueue[index];

      if (item.username && currentUsername && item.username !== currentUsername) {
        remaining.push(item);
        continue;
      }

      try {
        await submitProgress(
          item.lesson,
          item.char_wpm,
          item.eff_wpm,
          item.accuracy,
          item.client_created_at
        );
      } catch {
        remaining.push(item);
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          remaining.push(...originalQueue.slice(index + 1));
          break;
        }
      }
    }

    writeQueue(remaining);
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export async function saveProgressOfflineFirst(args: {
  lesson: number;
  char_wpm: number;
  eff_wpm: number;
  accuracy: number;
  /** Optional completion time for the record; defaults to now. */
  clientCreatedAt?: string;
}): Promise<void> {
  const payload: ProgressPayload = {
    lesson: args.lesson,
    char_wpm: args.char_wpm,
    eff_wpm: args.eff_wpm,
    accuracy: args.accuracy,
    client_created_at: args.clientCreatedAt ?? new Date().toISOString(),
    username: localStorage.getItem(AUTH_STORAGE_KEYS.username) ?? undefined,
    queued_at: new Date().toISOString()
  };

  if (shouldAttemptUpload()) {
    try {
      await submitProgress(
        payload.lesson,
        payload.char_wpm,
        payload.eff_wpm,
        payload.accuracy,
        payload.client_created_at
      );
      await flushQueuedProgress();
      return;
    } catch {
      // Queue when request fails for network/transient auth reasons.
    }
  }

  enqueue(payload);
}

export function initializeProgressSync(): void {
  if (!canUseStorage() || syncInitialized) return;
  syncInitialized = true;

  window.addEventListener('online', () => {
    void flushQueuedProgress();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void flushQueuedProgress();
    }
  });

  void flushQueuedProgress();
}

/**
 * Adapt the offline-first progress queue to the trainer's `ResultRecorder`
 * port. Payloads, storage keys and guest/account behaviour are exactly those
 * of `saveProgressOfflineFirst`; recording an attempt at most once is the
 * session's responsibility.
 */
export function createProgressRecorder(): ResultRecorder {
  return {
    async record(result: AttemptResult): Promise<void> {
      await saveProgressOfflineFirst({
        lesson: result.lesson,
        char_wpm: result.charWpm,
        eff_wpm: result.effWpm,
        accuracy: result.accuracy,
        clientCreatedAt: result.completedAt
      });
    }
  };
}

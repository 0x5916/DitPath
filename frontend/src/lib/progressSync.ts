import { getAuthSession, isAuthSessionCurrent, type AuthSession } from '#lib/auth.ts';
import { submitProgress } from '#lib/api.ts';
import type { ProgressRecord } from '#lib/api.ts';
import type { AttemptResult, ResultRecorder } from '#lib/training/result.ts';
import { AUTH_STORAGE_KEYS, CW_STORAGE_KEYS } from '#lib/storageKeys.ts';

type ProgressPayload = {
  id?: string;
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
let flushInFlight: { generation: number; promise: Promise<void> } | null = null;

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
        (value.username === undefined || typeof value.username === 'string') &&
        (value.id === undefined || typeof value.id === 'string')
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

/** Serialize only local read/modify/write work across cooperating browser tabs. */
async function updateQueue<T>(
  update: (queue: ProgressPayload[]) => { queue: ProgressPayload[]; value: T }
): Promise<T> {
  const mutate = () => {
    const result = update(readQueue());
    writeQueue(result.queue);
    return result.value;
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(`ditpath:${CW_STORAGE_KEYS.progressQueue}`, mutate);
  }
  // Older browsers still preserve same-tab appends; cross-tab writes need Web Locks.
  return mutate();
}

async function enqueue(item: ProgressPayload): Promise<void> {
  await updateQueue((queue) => {
    queue.push({ ...item, id: crypto.randomUUID() });
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    return { queue, value: undefined };
  });
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

/** Claim guest records before uploading so a later account cannot adopt in-flight work. */
async function claimQueue(session: AuthSession): Promise<ProgressPayload[]> {
  return updateQueue((original) => {
    if (!isAuthSessionCurrent(session)) return { queue: original, value: [] };
    const queue = original.map((item) => ({
      ...item,
      id: item.id ?? crypto.randomUUID(),
      username: item.username ?? session.username ?? undefined
    }));
    return { queue, value: sortQueue(queue) };
  });
}

async function runFlush(session: AuthSession): Promise<void> {
  const attempted = new Set<string>();
  while (isAuthSessionCurrent(session) && shouldAttemptUpload()) {
    const queue = await claimQueue(session);
    if (!isAuthSessionCurrent(session)) return;
    const item = queue.find(
      (entry) =>
        !attempted.has(entry.id!) && (!entry.username || entry.username === session.username)
    );
    if (!item) return;
    attempted.add(item.id!);

    try {
      await submitProgress(
        item.lesson,
        item.char_wpm,
        item.eff_wpm,
        item.accuracy,
        item.client_created_at
      );
      if (!isAuthSessionCurrent(session)) return;
      // Read again after the await: another attempt may have been queued meanwhile.
      await updateQueue((latest) => ({
        queue: isAuthSessionCurrent(session)
          ? latest.filter((entry) => entry.id !== item.id)
          : latest,
        value: undefined
      }));
      if (!isAuthSessionCurrent(session)) return;
    } catch {
      // Keep the original owner and record on cancellation or a transient failure.
      if (!isAuthSessionCurrent(session)) return;
    }
  }
}

/** One uploader per origin; storage mutations use a different, short-lived lock. */
async function runExclusiveFlush(session: AuthSession): Promise<void> {
  const upload = () => runFlush(session);
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    await navigator.locks.request(`ditpath:${CW_STORAGE_KEYS.progressQueue}:upload`, upload);
  } else {
    // Without Web Locks, separate tabs may submit the same queued record.
    await upload();
  }
}

export async function flushQueuedProgress(): Promise<void> {
  if (!canUseStorage() || !shouldAttemptUpload()) return;
  const session = getAuthSession();
  if (flushInFlight?.generation === session.generation) return flushInFlight.promise;

  const request = { generation: session.generation, promise: runExclusiveFlush(session) };
  flushInFlight = request;
  try {
    await request.promise;
  } finally {
    if (flushInFlight === request) flushInFlight = null;
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
  if (!canUseStorage()) return;
  await enqueue({
    lesson: args.lesson,
    char_wpm: args.char_wpm,
    eff_wpm: args.eff_wpm,
    accuracy: args.accuracy,
    client_created_at: args.clientCreatedAt ?? new Date().toISOString(),
    username: getAuthSession().username ?? undefined,
    queued_at: new Date().toISOString()
  });
  await flushQueuedProgress();
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

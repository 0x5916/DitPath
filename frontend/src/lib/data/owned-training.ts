import type {
  AttemptEvent,
  HistorySessionRecord,
  TrainingSessionRecord
} from '../training/v2/types';
import { reqToPromise } from './training-db';
import { OWNED_STORES } from './training-schema';

export type TrainingOwner = string;
export type RecordKind = 'attempt' | 'session';
export type Owned<T> = T & { ownerKey: string };
export interface FrozenOutboxRecord {
  ownerKey: string;
  kind: RecordKind;
  id: string;
  payload: AttemptEvent | TrainingSessionRecord;
  payloadKey: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  permanentError?: string;
}

/** Stable semantic representation, also used to match acknowledgements to frozen content. */
export function payloadKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(payloadKey).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${payloadKey(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function stripOwner<T>(record: Owned<T>): T {
  const { ownerKey: _owner, ...value } = record;
  void _owner;
  return value as T;
}

export async function ownedRecords<T>(store: IDBObjectStore, ownerKey: string): Promise<T[]> {
  return (await reqToPromise<Owned<T>[]>(store.index('ownerKey').getAll(ownerKey))).map(stripOwner);
}

export async function enqueueFrozen(
  stores: Record<string, IDBObjectStore>,
  ownerKey: string,
  kind: RecordKind,
  payload: AttemptEvent | TrainingSessionRecord
): Promise<void> {
  if (!ownerKey.startsWith('account:')) return;
  const store = stores[OWNED_STORES.outbox];
  const key = [ownerKey, kind, payload.id];
  const existing = await reqToPromise<FrozenOutboxRecord | undefined>(store.get(key));
  const frozenKey = payloadKey(payload);
  if (existing) {
    if (existing.payloadKey !== frozenKey)
      throw new Error(`Immutable ${kind} conflict: ${payload.id}`);
    return;
  }
  await reqToPromise(
    store.add({
      ownerKey,
      kind,
      id: payload.id,
      payload,
      payloadKey: frozenKey,
      createdAt: new Date().toISOString(),
      retryCount: 0
    } satisfies FrozenOutboxRecord)
  );
}

export function isNativeSession(value: HistorySessionRecord): value is TrainingSessionRecord {
  return (
    value.mode !== 'legacy' &&
    value.sourceKind !== 'legacy_v1' &&
    typeof value.startedAt === 'string' &&
    typeof value.charWpm === 'number' &&
    typeof value.effWpm === 'number' &&
    typeof value.freqHz === 'number' &&
    typeof value.promptCount === 'number' &&
    typeof value.completedPromptCount === 'number'
  );
}

export async function persistSession(
  stores: Record<string, IDBObjectStore>,
  ownerKey: string,
  session: TrainingSessionRecord
): Promise<void> {
  const store = stores[OWNED_STORES.sessions];
  const existing = await reqToPromise<Owned<TrainingSessionRecord> | undefined>(
    store.get([ownerKey, session.id])
  );
  if (
    ownerKey.startsWith('account:') &&
    existing &&
    existing.status !== 'in-progress' &&
    session.status === 'in-progress'
  ) {
    throw new Error(`Immutable session conflict: ${session.id}`);
  }
  let finalized = session;
  if (session.status !== 'in-progress') {
    const attempts = await reqToPromise<Owned<AttemptEvent>[]>(
      stores[OWNED_STORES.attempts].index('sessionId').getAll([ownerKey, session.id])
    );
    const scored = attempts.filter((attempt) => attempt.classification !== 'unmeasured');
    const accuracy = scored.length
      ? Math.round((scored.filter((attempt) => attempt.isCorrect).length / scored.length) * 1000) /
        1000
      : undefined;
    finalized = {
      ...session,
      ...(session.mode === 'practice' ? {} : { accuracy }),
      eventIds: session.mode === 'practice' ? [] : attempts.map((entry) => entry.id).sort()
    };
    if (
      ownerKey.startsWith('account:') &&
      existing?.status !== 'in-progress' &&
      existing &&
      payloadKey(stripOwner(existing)) !== payloadKey(finalized)
    )
      throw new Error(`Immutable session conflict: ${session.id}`);
  }
  // Preserve the historical guest API shape. Account records always freeze a manifest.
  const stored = ownerKey.startsWith('account:')
    ? finalized
    : session.status !== 'in-progress' && session.mode !== 'practice'
      ? { ...session, accuracy: finalized.accuracy }
      : session;
  await reqToPromise(store.put({ ...stored, ownerKey }));
  if (session.status !== 'in-progress') await enqueueFrozen(stores, ownerKey, 'session', finalized);
}

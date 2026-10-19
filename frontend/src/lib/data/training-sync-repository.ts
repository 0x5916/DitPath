import type {
  AttemptEvent,
  HistorySessionRecord,
  TrainingSessionRecord
} from '../training/v2/types';
import { attemptToWire, sessionToWire } from '../training-wire';
import { hasPendingTrainingPersistence } from '../pending-training-persistence';
import { reqToPromise, withTransaction } from './training-db';
import { OWNED_STORES, TRAINING_STORES } from './training-schema';
import {
  enqueueFrozen,
  isNativeSession,
  ownedRecords,
  payloadKey,
  persistSession,
  stripOwner,
  type FrozenOutboxRecord,
  type Owned,
  type RecordKind
} from './owned-training';
import { notifyTrainingDataChange } from './training-data-events';
export { subscribeTrainingDataChanges } from './training-data-events';
export type { FrozenOutboxRecord, RecordKind } from './owned-training';

export interface DownloadPage {
  attempts: AttemptEvent[];
  sessions: HistorySessionRecord[];
  nextCursor: string;
  expectedCursor: string | null;
}
interface ImportAssignment {
  installationId: string;
  kind: RecordKind;
  id: string;
  ownerKey: string;
}
const allStores = Object.values(OWNED_STORES);

function canonicalImportRecord(
  kind: RecordKind,
  value: AttemptEvent | TrainingSessionRecord
): string {
  if (kind === 'attempt') {
    const wire = attemptToWire(value as AttemptEvent);
    return payloadKey({
      ...wire,
      created_at: new Date(wire.created_at).toISOString(),
      target_character: wire.target_character.trim(),
      entered_text: wire.entered_text.trim()
    });
  }
  const wire = sessionToWire(value as TrainingSessionRecord);
  return payloadKey({
    ...wire,
    started_at: new Date(wire.started_at).toISOString(),
    ended_at: wire.ended_at ? new Date(wire.ended_at).toISOString() : null,
    event_ids: [...(wire.event_ids ?? [])].sort()
  });
}

export async function getTrainingInstallationId(db: IDBDatabase): Promise<string> {
  const candidate = globalThis.crypto.randomUUID();
  return withTransaction(db, TRAINING_STORES.meta, 'readwrite', async (stores) => {
    const store = stores[TRAINING_STORES.meta];
    const existing = await reqToPromise<{ value: string } | undefined>(store.get('installationId'));
    if (existing) return existing.value;
    await reqToPromise(store.add({ key: 'installationId', value: candidate }));
    return candidate;
  });
}

export function createTrainingSyncRepository(db: IDBDatabase, ownerKey: string) {
  const readQueue = () =>
    withTransaction(db, OWNED_STORES.outbox, 'readonly', (stores) =>
      reqToPromise<FrozenOutboxRecord[]>(
        stores[OWNED_STORES.outbox].index('ownerKey').getAll(ownerKey)
      )
    );
  return {
    async getPending(kind?: RecordKind, limit = 100): Promise<FrozenOutboxRecord[]> {
      return (await readQueue())
        .filter((record) => !record.permanentError && (!kind || record.kind === kind))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    async getFailures(): Promise<FrozenOutboxRecord[]> {
      return (await readQueue()).filter((record) => record.permanentError);
    },
    async countPending(): Promise<number> {
      return (await readQueue()).length;
    },
    async getSessionDependencies(
      record: FrozenOutboxRecord
    ): Promise<{ pending: boolean; permanentError?: string }> {
      if (record.ownerKey !== ownerKey || record.kind !== 'session')
        throw new Error('Session dependency ownership mismatch');
      return withTransaction(db, OWNED_STORES.outbox, 'readonly', async (stores) => {
        let pending = false;
        for (const id of ('eventIds' in record.payload ? record.payload.eventIds : undefined) ??
          []) {
          const dependency = await reqToPromise<FrozenOutboxRecord | undefined>(
            stores[OWNED_STORES.outbox].get([ownerKey, 'attempt', id])
          );
          if (dependency?.permanentError)
            return { pending: true, permanentError: dependency.permanentError };
          if (dependency) pending = true;
        }
        return { pending };
      });
    },
    async acknowledge(records: FrozenOutboxRecord[]): Promise<void> {
      await withTransaction(db, OWNED_STORES.outbox, 'readwrite', async (stores) => {
        for (const record of records) {
          if (record.ownerKey !== ownerKey) continue;
          const key = [ownerKey, record.kind, record.id];
          const existing = await reqToPromise<FrozenOutboxRecord | undefined>(
            stores[OWNED_STORES.outbox].get(key)
          );
          if (
            existing?.payloadKey === record.payloadKey &&
            payloadKey(record.payload) === record.payloadKey
          ) {
            await reqToPromise(stores[OWNED_STORES.outbox].delete(key));
          }
        }
      });
      notifyTrainingDataChange(ownerKey, false);
    },
    async reject(record: FrozenOutboxRecord, error: string, permanent = false): Promise<void> {
      await withTransaction(db, OWNED_STORES.outbox, 'readwrite', async (stores) => {
        if (record.ownerKey !== ownerKey) return;
        const key = [ownerKey, record.kind, record.id];
        const existing = await reqToPromise<FrozenOutboxRecord | undefined>(
          stores[OWNED_STORES.outbox].get(key)
        );
        if (existing?.payloadKey !== record.payloadKey) return;
        await reqToPromise(
          stores[OWNED_STORES.outbox].put({
            ...existing,
            retryCount: existing.retryCount + 1,
            lastError: error,
            ...(permanent ? { permanentError: error } : {})
          })
        );
      });
      notifyTrainingDataChange(ownerKey, false);
    },
    async getCursor(): Promise<string | null> {
      return withTransaction(
        db,
        OWNED_STORES.meta,
        'readonly',
        async (stores) =>
          (
            await reqToPromise<{ value: string } | undefined>(
              stores[OWNED_STORES.meta].get([ownerKey, 'downloadCursor'])
            )
          )?.value ?? null
      );
    },
    async resetCursor(): Promise<void> {
      await withTransaction(db, OWNED_STORES.meta, 'readwrite', async (stores) => {
        await reqToPromise(stores[OWNED_STORES.meta].delete([ownerKey, 'downloadCursor']));
      });
    },
    async applyDownloadPage(page: DownloadPage): Promise<void> {
      await withTransaction(
        db,
        [OWNED_STORES.attempts, OWNED_STORES.sessions, OWNED_STORES.outbox, OWNED_STORES.meta],
        'readwrite',
        async (stores) => {
          const cursor = await reqToPromise<{ value: string } | undefined>(
            stores[OWNED_STORES.meta].get([ownerKey, 'downloadCursor'])
          );
          if ((cursor?.value ?? null) !== page.expectedCursor)
            throw new Error('Training download cursor changed');
          for (const [kind, records] of [
            ['attempt', page.attempts],
            ['session', page.sessions]
          ] as const) {
            for (const record of records) {
              const pending = await reqToPromise(
                stores[OWNED_STORES.outbox].get([ownerKey, kind, record.id])
              );
              if (!pending)
                await reqToPromise(
                  stores[kind === 'attempt' ? OWNED_STORES.attempts : OWNED_STORES.sessions].put({
                    ...record,
                    ownerKey
                  })
                );
            }
          }
          await reqToPromise(
            stores[OWNED_STORES.meta].put({
              ownerKey,
              key: 'downloadCursor',
              value: page.nextCursor
            })
          );
        }
      );
      notifyTrainingDataChange(ownerKey, false);
    },
    async getUnclaimedCount(): Promise<number> {
      return withTransaction(
        db,
        [OWNED_STORES.attempts, OWNED_STORES.sessions, OWNED_STORES.imports],
        'readonly',
        async (stores) => {
          const assigned = new Set(
            (await reqToPromise<ImportAssignment[]>(stores[OWNED_STORES.imports].getAll())).map(
              (entry) => `${entry.kind}:${entry.id}`
            )
          );
          const attempts = await ownedRecords<AttemptEvent>(
            stores[OWNED_STORES.attempts],
            'unclaimed'
          );
          const sessions = await ownedRecords<HistorySessionRecord>(
            stores[OWNED_STORES.sessions],
            'unclaimed'
          );
          return (
            attempts.filter((record) => !assigned.has(`attempt:${record.id}`)).length +
            sessions.filter((record) => !assigned.has(`session:${record.id}`)).length
          );
        }
      );
    },
    async importUnclaimed(installationId: string): Promise<number> {
      if (!ownerKey.startsWith('account:') || !installationId)
        throw new Error('Device history import requires an account and installation identity');
      const count = await withTransaction(db, allStores, 'readwrite', async (stores) => {
        let imported = 0;
        const attempts = await ownedRecords<AttemptEvent>(
          stores[OWNED_STORES.attempts],
          'unclaimed'
        );
        const sessions = await ownedRecords<HistorySessionRecord>(
          stores[OWNED_STORES.sessions],
          'unclaimed'
        );
        for (const [kind, records] of [
          ['attempt', attempts],
          ['session', sessions]
        ] as const)
          for (const record of records) {
            const journal = stores[OWNED_STORES.imports];
            if (await reqToPromise(journal.get([installationId, kind, record.id]))) continue;
            const target =
              stores[kind === 'attempt' ? OWNED_STORES.attempts : OWNED_STORES.sessions];
            const existing = await reqToPromise<Owned<typeof record> | undefined>(
              target.get([ownerKey, record.id])
            );
            const nativeSession =
              kind === 'session' && isNativeSession(record as HistorySessionRecord)
                ? (record as TrainingSessionRecord)
                : null;
            if (kind === 'session' && !nativeSession) continue;
            const candidate = nativeSession
              ? {
                  ...nativeSession,
                  status:
                    nativeSession.status === 'in-progress'
                      ? ('abandoned' as const)
                      : nativeSession.status,
                  eventIds:
                    nativeSession.mode === 'practice'
                      ? []
                      : attempts
                          .filter((attempt) => attempt.sessionId === record.id)
                          .map((attempt) => attempt.id)
                          .sort()
                }
              : (record as AttemptEvent);
            if (existing) {
              try {
                if (
                  canonicalImportRecord(kind, candidate) !==
                  canonicalImportRecord(
                    kind,
                    stripOwner(existing) as AttemptEvent | TrainingSessionRecord
                  )
                ) {
                  throw new Error('different content');
                }
              } catch {
                throw new Error(`Device history ID conflict: ${record.id}`);
              }
            } else if (kind === 'attempt') {
              await reqToPromise(target.add({ ...record, ownerKey }));
              await enqueueFrozen(stores, ownerKey, 'attempt', record as AttemptEvent);
            } else {
              const accountAttempts = await reqToPromise<Owned<AttemptEvent>[]>(
                stores[OWNED_STORES.attempts].index('sessionId').getAll([ownerKey, record.id])
              );
              if (
                nativeSession?.mode !== 'practice' &&
                payloadKey(accountAttempts.map((attempt) => attempt.id).sort()) !==
                  payloadKey((candidate as TrainingSessionRecord).eventIds)
              ) {
                throw new Error(`Device history ID conflict: ${record.id}`);
              }
              await persistSession(stores, ownerKey, candidate as TrainingSessionRecord);
            }
            await reqToPromise(
              journal.add({
                installationId,
                kind,
                id: record.id,
                ownerKey
              } satisfies ImportAssignment)
            );
            imported++;
          }
        return imported;
      });
      notifyTrainingDataChange(ownerKey, true);
      return count;
    },
    async clearDownloadedCache(): Promise<void> {
      if (hasPendingTrainingPersistence()) {
        throw new Error('Pending training uploads must be synchronized before clearing history');
      }
      await withTransaction(
        db,
        [
          OWNED_STORES.attempts,
          OWNED_STORES.sessions,
          OWNED_STORES.outbox,
          OWNED_STORES.meta,
          OWNED_STORES.mastery
        ],
        'readwrite',
        async (stores) => {
          if (await reqToPromise(stores[OWNED_STORES.outbox].index('ownerKey').count(ownerKey)))
            throw new Error(
              'Pending training uploads must be synchronized before clearing history'
            );
          const sessions = await reqToPromise<Owned<HistorySessionRecord>[]>(
            stores[OWNED_STORES.sessions].getAll()
          );
          if (
            sessions.some(
              (session) =>
                session.ownerKey.startsWith('account:') && session.status === 'in-progress'
            )
          ) {
            throw new Error(
              'Pending training uploads must be synchronized before clearing history'
            );
          }
          for (const name of [OWNED_STORES.attempts, OWNED_STORES.sessions]) {
            for (const record of await ownedRecords<{ id: string }>(stores[name], ownerKey))
              await reqToPromise(stores[name].delete([ownerKey, record.id]));
          }
          await reqToPromise(stores[OWNED_STORES.meta].delete([ownerKey, 'downloadCursor']));
        }
      );
      notifyTrainingDataChange(ownerKey, true);
    }
  };
}
export type TrainingSyncRepository = ReturnType<typeof createTrainingSyncRepository>;

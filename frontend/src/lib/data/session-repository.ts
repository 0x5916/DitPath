/** Owner-scoped guided and practice session history. */
import type {
  HistorySessionRecord,
  SessionProgressStatus,
  TrainingSessionRecord
} from '../training/v2/types';
import { reqToPromise, withTransaction } from './training-db';
import { OWNED_STORES } from './training-schema';
import {
  isNativeSession,
  ownedRecords,
  persistSession,
  stripOwner,
  type Owned
} from './owned-training';
import { notifyTrainingDataChange } from './training-data-events';

export interface SessionRepository {
  saveSession(session: TrainingSessionRecord): Promise<void>;
  getSession(id: string): Promise<TrainingSessionRecord | null>;
  getLatestInProgressSession(): Promise<TrainingSessionRecord | null>;
  getSessions(limit?: number, status?: SessionProgressStatus): Promise<HistorySessionRecord[]>;
  getSessionsByTimeRange(startIso: string, endIso: string): Promise<HistorySessionRecord[]>;
  updateSessionProgress(
    id: string,
    completedPromptCount: number,
    status?: SessionProgressStatus,
    completedAt?: string
  ): Promise<void>;
}

const sessionTime = (record: HistorySessionRecord) =>
  record.occurredAt ?? record.completedAt ?? record.startedAt ?? '';
export function createSessionRepository(
  db: IDBDatabase,
  ownerKey = 'unclaimed'
): SessionRepository {
  const stores = [OWNED_STORES.sessions, OWNED_STORES.attempts, OWNED_STORES.outbox];
  const all = () =>
    withTransaction(db, OWNED_STORES.sessions, 'readonly', async (stores) =>
      (await ownedRecords<HistorySessionRecord>(stores[OWNED_STORES.sessions], ownerKey)).sort(
        (a, b) => sessionTime(b).localeCompare(sessionTime(a)) || b.id.localeCompare(a.id)
      )
    );
  return {
    async saveSession(session) {
      await withTransaction(db, stores, 'readwrite', (stores) =>
        persistSession(stores, ownerKey, session)
      );
      notifyTrainingDataChange(ownerKey, true);
    },
    async getSession(id) {
      return withTransaction(db, OWNED_STORES.sessions, 'readonly', async (stores) => {
        const record = await reqToPromise<Owned<HistorySessionRecord> | undefined>(
          stores[OWNED_STORES.sessions].get([ownerKey, id])
        );
        const value = record ? stripOwner(record) : null;
        return value && isNativeSession(value) ? value : null;
      });
    },
    async getLatestInProgressSession() {
      const latest = (await all())
        .filter(isNativeSession)
        .filter((record) => record.mode !== 'practice')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      return latest?.status === 'in-progress' ? latest : null;
    },
    async getSessions(limit, status) {
      const records = (await all()).filter(
        (record) => status === undefined || record.status === status
      );
      return limit ? records.slice(0, limit) : records;
    },
    async getSessionsByTimeRange(startIso, endIso) {
      return (await all())
        .filter((record) => sessionTime(record) >= startIso && sessionTime(record) <= endIso)
        .sort((a, b) => sessionTime(a).localeCompare(sessionTime(b)) || a.id.localeCompare(b.id));
    },
    async updateSessionProgress(id, completedPromptCount, status, completedAt) {
      await withTransaction(db, stores, 'readwrite', async (stores) => {
        const record = await reqToPromise<Owned<HistorySessionRecord> | undefined>(
          stores[OWNED_STORES.sessions].get([ownerKey, id])
        );
        const value = record ? stripOwner(record) : null;
        if (!value || !isNativeSession(value))
          throw new Error(`Cannot update non-existent session ${id}`);
        await persistSession(stores, ownerKey, {
          ...value,
          completedPromptCount,
          status: status ?? value.status,
          ...(completedAt !== undefined ? { completedAt } : {})
        });
      });
      notifyTrainingDataChange(ownerKey, true);
    }
  };
}

/**
 * Session Repository for DitPath local storage.
 *
 * Manages guided session metadata and lifecycle states (in-progress, completed, abandoned).
 */

import type { SessionProgressStatus, TrainingSessionRecord } from '../training/v2/types';
import { reqToPromise, withTransaction } from './training-db';
import { TRAINING_STORES } from './training-schema';

export interface SessionRepository {
  saveSession(session: TrainingSessionRecord): Promise<void>;
  getSession(id: string): Promise<TrainingSessionRecord | null>;
  /** Offers only the latest session; newer sessions supersede older unfinished ones. */
  getLatestInProgressSession(): Promise<TrainingSessionRecord | null>;
  getSessions(limit?: number): Promise<TrainingSessionRecord[]>;
  getSessionsByTimeRange(startIso: string, endIso: string): Promise<TrainingSessionRecord[]>;
  updateSessionProgress(
    id: string,
    completedPromptCount: number,
    status?: SessionProgressStatus,
    completedAt?: string
  ): Promise<void>;
}

export function createSessionRepository(db: IDBDatabase): SessionRepository {
  return {
    async saveSession(session: TrainingSessionRecord): Promise<void> {
      await withTransaction(db, TRAINING_STORES.sessions, 'readwrite', async (stores) => {
        await reqToPromise(stores[TRAINING_STORES.sessions].put(session));
      });
    },

    async getSession(id: string): Promise<TrainingSessionRecord | null> {
      return await withTransaction(db, TRAINING_STORES.sessions, 'readonly', async (stores) => {
        const result = await reqToPromise<TrainingSessionRecord | undefined>(
          stores[TRAINING_STORES.sessions].get(id)
        );
        return result ?? null;
      });
    },

    async getLatestInProgressSession(): Promise<TrainingSessionRecord | null> {
      return await withTransaction(db, TRAINING_STORES.sessions, 'readonly', async (stores) => {
        const store = stores[TRAINING_STORES.sessions];
        const index = store.index('startedAt');

        // Open cursor descending (prev) to inspect most recent sessions first
        return new Promise<TrainingSessionRecord | null>((resolve, reject) => {
          const request = index.openCursor(null, 'prev');

          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve(null);
              return;
            }

            const record = cursor.value as TrainingSessionRecord;
            resolve(record.status === 'in-progress' ? record : null);
          };

          request.onerror = () => {
            reject(request.error ?? new Error('Failed to query in-progress session cursor'));
          };
        });
      });
    },

    async getSessions(limit?: number): Promise<TrainingSessionRecord[]> {
      return await withTransaction(db, TRAINING_STORES.sessions, 'readonly', async (stores) => {
        const store = stores[TRAINING_STORES.sessions];
        const index = store.index('startedAt');

        return new Promise<TrainingSessionRecord[]>((resolve, reject) => {
          const results: TrainingSessionRecord[] = [];
          const request = index.openCursor(null, 'prev');

          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || (limit && results.length >= limit)) {
              resolve(results);
              return;
            }
            results.push(cursor.value as TrainingSessionRecord);
            cursor.continue();
          };

          request.onerror = () => {
            reject(request.error ?? new Error('Failed to query sessions cursor'));
          };
        });
      });
    },

    async getSessionsByTimeRange(
      startIso: string,
      endIso: string
    ): Promise<TrainingSessionRecord[]> {
      return withTransaction(db, TRAINING_STORES.sessions, 'readonly', (stores) =>
        reqToPromise<TrainingSessionRecord[]>(
          stores[TRAINING_STORES.sessions]
            .index('startedAt')
            .getAll(IDBKeyRange.bound(startIso, endIso))
        )
      );
    },

    async updateSessionProgress(
      id: string,
      completedPromptCount: number,
      status?: SessionProgressStatus,
      completedAt?: string
    ): Promise<void> {
      await withTransaction(db, TRAINING_STORES.sessions, 'readwrite', async (stores) => {
        const store = stores[TRAINING_STORES.sessions];
        const existing = await reqToPromise<TrainingSessionRecord | undefined>(store.get(id));
        if (!existing) {
          throw new Error(`Cannot update non-existent session ${id}`);
        }

        const updated: TrainingSessionRecord = {
          ...existing,
          completedPromptCount,
          status: status ?? existing.status,
          completedAt: completedAt ?? existing.completedAt
        };

        await reqToPromise(store.put(updated));
      });
    }
  };
}

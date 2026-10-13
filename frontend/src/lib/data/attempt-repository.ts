/**
 * Attempt Repository for DitPath local storage.
 *
 * Provides transactional, indexed access to immutable AttemptEvents.
 */

import type { AttemptEvent } from '../training/v2/types';
import { reqToPromise, withTransaction } from './training-db';
import { TRAINING_STORES } from './training-schema';

export interface AttemptRepository {
  /** Saves an attempt event idempotently (saving the same ID overwrites cleanly without error). */
  saveAttempt(attempt: AttemptEvent): Promise<void>;
  saveAttempts(attempts: AttemptEvent[]): Promise<void>;
  getAttempt(id: string): Promise<AttemptEvent | null>;
  getAttemptsBySession(sessionId: string): Promise<AttemptEvent[]>;
  getAttemptsByCharacter(character: string, limit?: number): Promise<AttemptEvent[]>;
  getAttemptsByTimeRange(startIso: string, endIso: string): Promise<AttemptEvent[]>;
  countAttempts(): Promise<number>;
}

function getKeyRange(): typeof IDBKeyRange {
  if (typeof IDBKeyRange !== 'undefined') return IDBKeyRange;
  if (typeof window !== 'undefined' && window.IDBKeyRange) return window.IDBKeyRange;
  throw new Error('IDBKeyRange is not available in current environment');
}

export function createAttemptRepository(db: IDBDatabase): AttemptRepository {
  return {
    async saveAttempt(attempt: AttemptEvent): Promise<void> {
      await withTransaction(db, TRAINING_STORES.attempts, 'readwrite', async (stores) => {
        await reqToPromise(stores[TRAINING_STORES.attempts].put(attempt));
      });
    },

    async saveAttempts(attempts: AttemptEvent[]): Promise<void> {
      if (attempts.length === 0) return;
      await withTransaction(db, TRAINING_STORES.attempts, 'readwrite', async (stores) => {
        const store = stores[TRAINING_STORES.attempts];
        for (const attempt of attempts) {
          await reqToPromise(store.put(attempt));
        }
      });
    },

    async getAttempt(id: string): Promise<AttemptEvent | null> {
      return await withTransaction(db, TRAINING_STORES.attempts, 'readonly', async (stores) => {
        const result = await reqToPromise<AttemptEvent | undefined>(
          stores[TRAINING_STORES.attempts].get(id)
        );
        return result ?? null;
      });
    },

    async getAttemptsBySession(sessionId: string): Promise<AttemptEvent[]> {
      return await withTransaction(db, TRAINING_STORES.attempts, 'readonly', async (stores) => {
        const index = stores[TRAINING_STORES.attempts].index('sessionId');
        const results = await reqToPromise<AttemptEvent[]>(index.getAll(sessionId));
        return results ?? [];
      });
    },

    async getAttemptsByCharacter(character: string, limit?: number): Promise<AttemptEvent[]> {
      return await withTransaction(db, TRAINING_STORES.attempts, 'readonly', async (stores) => {
        const index = stores[TRAINING_STORES.attempts].index('targetCharacter');
        const results = await reqToPromise<AttemptEvent[]>(
          index.getAll(character, limit ? Math.max(1, limit) : undefined)
        );
        return results ?? [];
      });
    },

    async getAttemptsByTimeRange(startIso: string, endIso: string): Promise<AttemptEvent[]> {
      return await withTransaction(db, TRAINING_STORES.attempts, 'readonly', async (stores) => {
        const index = stores[TRAINING_STORES.attempts].index('createdAt');
        const range = getKeyRange().bound(startIso, endIso);
        const results = await reqToPromise<AttemptEvent[]>(index.getAll(range));
        return results ?? [];
      });
    },

    async countAttempts(): Promise<number> {
      return await withTransaction(db, TRAINING_STORES.attempts, 'readonly', async (stores) => {
        return await reqToPromise<number>(stores[TRAINING_STORES.attempts].count());
      });
    }
  };
}

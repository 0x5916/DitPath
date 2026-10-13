/**
 * Outbox Repository for DitPath local storage.
 *
 * Buffers AttemptEvents for synchronization to the server while offline.
 * Acknowledged events are purged idempotently.
 */

import type { AttemptEvent } from '../training/v2/types';
import { reqToPromise, withTransaction } from './training-db';
import { TRAINING_STORES } from './training-schema';

export interface OutboxRecord {
  eventId: string;
  payload: AttemptEvent;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export interface OutboxRepository {
  enqueue(event: AttemptEvent): Promise<void>;
  enqueueBatch(events: AttemptEvent[]): Promise<void>;
  getPending(limit?: number): Promise<OutboxRecord[]>;
  acknowledge(eventIds: string[]): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
  countPending(): Promise<number>;
  clear(): Promise<void>;
}

export function createOutboxRepository(db: IDBDatabase): OutboxRepository {
  return {
    async enqueue(event: AttemptEvent): Promise<void> {
      const record: OutboxRecord = {
        eventId: event.id,
        payload: event,
        createdAt: event.createdAt,
        retryCount: 0
      };

      await withTransaction(db, TRAINING_STORES.outbox, 'readwrite', async (stores) => {
        await reqToPromise(stores[TRAINING_STORES.outbox].put(record));
      });
    },

    async enqueueBatch(events: AttemptEvent[]): Promise<void> {
      if (events.length === 0) return;
      await withTransaction(db, TRAINING_STORES.outbox, 'readwrite', async (stores) => {
        const store = stores[TRAINING_STORES.outbox];
        for (const event of events) {
          const record: OutboxRecord = {
            eventId: event.id,
            payload: event,
            createdAt: event.createdAt,
            retryCount: 0
          };
          await reqToPromise(store.put(record));
        }
      });
    },

    async getPending(limit?: number): Promise<OutboxRecord[]> {
      return await withTransaction(db, TRAINING_STORES.outbox, 'readonly', async (stores) => {
        const store = stores[TRAINING_STORES.outbox];
        const index = store.index('createdAt');
        const results = await reqToPromise<OutboxRecord[]>(
          index.getAll(null, limit ? Math.max(1, limit) : undefined)
        );
        return results ?? [];
      });
    },

    async acknowledge(eventIds: string[]): Promise<void> {
      if (eventIds.length === 0) return;
      await withTransaction(db, TRAINING_STORES.outbox, 'readwrite', async (stores) => {
        const store = stores[TRAINING_STORES.outbox];
        for (const id of eventIds) {
          await reqToPromise(store.delete(id));
        }
      });
    },

    async markFailed(eventId: string, error: string): Promise<void> {
      await withTransaction(db, TRAINING_STORES.outbox, 'readwrite', async (stores) => {
        const store = stores[TRAINING_STORES.outbox];
        const record = await reqToPromise<OutboxRecord | undefined>(store.get(eventId));
        if (record) {
          record.retryCount += 1;
          record.lastError = error;
          await reqToPromise(store.put(record));
        }
      });
    },

    async countPending(): Promise<number> {
      return await withTransaction(db, TRAINING_STORES.outbox, 'readonly', async (stores) => {
        return await reqToPromise<number>(stores[TRAINING_STORES.outbox].count());
      });
    },

    async clear(): Promise<void> {
      await withTransaction(db, TRAINING_STORES.outbox, 'readwrite', async (stores) => {
        await reqToPromise(stores[TRAINING_STORES.outbox].clear());
      });
    }
  };
}

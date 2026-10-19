/**
 * Attempt Repository for DitPath local storage.
 *
 * Provides transactional, indexed access to immutable AttemptEvents.
 */

import type { AttemptEvent } from '../training/v2/types';
import { reqToPromise, withTransaction } from './training-db';
import { OWNED_STORES } from './training-schema';
import { enqueueFrozen, ownedRecords, payloadKey, stripOwner, type Owned } from './owned-training';
import { notifyTrainingDataChange } from './training-data-events';
import type { TrainingSessionRecord } from '../training/v2/types';

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

export function createAttemptRepository(
  db: IDBDatabase,
  ownerKey = 'unclaimed'
): AttemptRepository {
  const save = async (attempts: AttemptEvent[]) => {
    await withTransaction(
      db,
      [OWNED_STORES.attempts, OWNED_STORES.sessions, OWNED_STORES.outbox],
      'readwrite',
      async (stores) => {
        for (const attempt of attempts) {
          const store = stores[OWNED_STORES.attempts];
          const existing = await reqToPromise<Owned<AttemptEvent> | undefined>(
            store.get([ownerKey, attempt.id])
          );
          if (existing && ownerKey.startsWith('account:')) {
            if (payloadKey(stripOwner(existing)) !== payloadKey(attempt))
              throw new Error(`Immutable attempt conflict: ${attempt.id}`);
            continue;
          }
          const sessionStore = stores[OWNED_STORES.sessions];
          const session = await reqToPromise<Owned<TrainingSessionRecord> | undefined>(
            sessionStore.get([ownerKey, attempt.sessionId])
          );
          if (
            !existing &&
            session?.status !== 'in-progress' &&
            session &&
            ownerKey.startsWith('account:')
          ) {
            throw new Error(`Cannot add evidence to finalized session ${session.id}`);
          }
          await reqToPromise(store.put({ ...attempt, ownerKey }));
          if (!existing && session)
            await reqToPromise(
              sessionStore.put({
                ...session,
                completedPromptCount: Math.min(
                  session.promptCount,
                  session.completedPromptCount + 1
                )
              })
            );
          await enqueueFrozen(stores, ownerKey, 'attempt', attempt);
        }
      }
    );
    notifyTrainingDataChange(ownerKey, true);
  };
  const all = () =>
    withTransaction(db, OWNED_STORES.attempts, 'readonly', (stores) =>
      ownedRecords<AttemptEvent>(stores[OWNED_STORES.attempts], ownerKey)
    );
  return {
    async saveAttempt(attempt: AttemptEvent): Promise<void> {
      await save([attempt]);
    },

    async saveAttempts(attempts: AttemptEvent[]): Promise<void> {
      if (attempts.length === 0) return;
      await save(attempts);
    },

    async getAttempt(id: string): Promise<AttemptEvent | null> {
      return await withTransaction(db, OWNED_STORES.attempts, 'readonly', async (stores) => {
        const result = await reqToPromise<Owned<AttemptEvent> | undefined>(
          stores[OWNED_STORES.attempts].get([ownerKey, id])
        );
        return result ? stripOwner(result) : null;
      });
    },

    async getAttemptsBySession(sessionId: string): Promise<AttemptEvent[]> {
      return (await all()).filter((attempt) => attempt.sessionId === sessionId);
    },

    async getAttemptsByCharacter(character: string, limit?: number): Promise<AttemptEvent[]> {
      const results = (await all()).filter((attempt) => attempt.targetCharacter === character);
      return limit ? results.slice(0, Math.max(1, limit)) : results;
    },

    async getAttemptsByTimeRange(startIso: string, endIso: string): Promise<AttemptEvent[]> {
      return (await all())
        .filter((attempt) => attempt.createdAt >= startIso && attempt.createdAt <= endIso)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async countAttempts(): Promise<number> {
      return (await all()).length;
    }
  };
}

import { describe, expect, it, beforeEach } from 'vitest';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import {
  closeTrainingDb,
  deleteTrainingDb,
  isIndexedDbAvailable,
  openTrainingDb,
  reqToPromise,
  withTransaction
} from './training-db';
import { TRAINING_STORES } from './training-schema';

describe('IndexedDB Foundation (training-db)', () => {
  beforeEach(async () => {
    await deleteTrainingDb(fakeIndexedDB);
  });

  it('detects indexedDB availability safely', () => {
    expect(isIndexedDbAvailable(fakeIndexedDB)).toBe(true);
    // When no window/indexedDB is present in a pure node environment:
    expect(isIndexedDbAvailable()).toBe(false);
  });

  it('creates all required object stores and indexes on first open', async () => {
    const db = await openTrainingDb(fakeIndexedDB);

    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain(TRAINING_STORES.attempts);
    expect(storeNames).toContain(TRAINING_STORES.sessions);
    expect(storeNames).toContain(TRAINING_STORES.mastery);
    expect(storeNames).toContain(TRAINING_STORES.outbox);
    expect(storeNames).toContain(TRAINING_STORES.settings);
    expect(storeNames).toContain(TRAINING_STORES.meta);

    // Verify indexes on attempts
    const tx = db.transaction([TRAINING_STORES.attempts], 'readonly');
    const attemptStore = tx.objectStore(TRAINING_STORES.attempts);
    expect(Array.from(attemptStore.indexNames)).toEqual(
      expect.arrayContaining(['sessionId', 'targetCharacter', 'createdAt'])
    );

    closeTrainingDb(db);
  });

  it('reopening does not erase or duplicate stores', async () => {
    let db = await openTrainingDb(fakeIndexedDB);

    await withTransaction(db, TRAINING_STORES.settings, 'readwrite', async (stores) => {
      await reqToPromise(stores[TRAINING_STORES.settings].put({ key: 'test_key', value: 42 }));
    });
    closeTrainingDb(db);

    // Reopen
    db = await openTrainingDb(fakeIndexedDB);
    const readVal = await withTransaction(
      db,
      TRAINING_STORES.settings,
      'readonly',
      async (stores) => {
        return await reqToPromise(stores[TRAINING_STORES.settings].get('test_key'));
      }
    );

    expect(readVal).toEqual({ key: 'test_key', value: 42 });
    closeTrainingDb(db);
  });

  it('aborts transaction if an error occurs within transaction block', async () => {
    const db = await openTrainingDb(fakeIndexedDB);

    await expect(
      withTransaction(db, TRAINING_STORES.settings, 'readwrite', async (stores) => {
        await reqToPromise(stores[TRAINING_STORES.settings].put({ key: 'should_abort', value: 1 }));
        throw new Error('Forced transaction failure');
      })
    ).rejects.toThrow('Forced transaction failure');

    const result = await withTransaction(
      db,
      TRAINING_STORES.settings,
      'readonly',
      async (stores) => {
        return await reqToPromise(stores[TRAINING_STORES.settings].get('should_abort'));
      }
    );

    expect(result).toBeUndefined();
    closeTrainingDb(db);
  });
});

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  closeTrainingDb,
  deleteTrainingDb,
  openTrainingDb,
  reqToPromise,
  withTransaction
} from './training-db';
import { migrateLegacyLocalStorage, type StorageLike } from './legacy-migration';
import { CW_STORAGE_KEYS } from '../storageKeys';
import { TRAINING_STORES } from './training-schema';

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }
}

describe('Legacy Local State Migration', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    await deleteTrainingDb(indexedDB);
    db = await openTrainingDb(indexedDB);
  });

  afterEach(() => {
    if (db) {
      closeTrainingDb(db);
    }
  });

  it('handles empty legacy storage safely without inventing mastery', async () => {
    const storage = new MemoryStorage();
    const result = await migrateLegacyLocalStorage(db, storage);

    expect(result.status).toBe('completed');
    expect(result.suggestedStep).toBe(1);
    expect(result.importedQueueCount).toBe(0);

    // Verify NO attempts or mastery records were synthesized
    const attemptsCount = await withTransaction(
      db,
      TRAINING_STORES.attempts,
      'readonly',
      async (s) => {
        return await reqToPromise(s[TRAINING_STORES.attempts].count());
      }
    );
    const masteryCount = await withTransaction(
      db,
      TRAINING_STORES.mastery,
      'readonly',
      async (s) => {
        return await reqToPromise(s[TRAINING_STORES.mastery].count());
      }
    );
    expect(attemptsCount).toBe(0);
    expect(masteryCount).toBe(0);
  });

  it('migrates valid legacy data: preserves lesson as suggestedStep and queues', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CW_STORAGE_KEYS.lesson, '7');
    storage.setItem(
      CW_STORAGE_KEYS.cwSettings,
      JSON.stringify({ char_wpm: 22, eff_wpm: 14, freq: 650, start_delay: 0.5 })
    );
    storage.setItem(
      CW_STORAGE_KEYS.progressQueue,
      JSON.stringify([
        {
          lesson: 6,
          char_wpm: 20,
          eff_wpm: 12,
          accuracy: 0.92,
          client_created_at: '2026-10-01T12:00:00.000Z',
          queued_at: '2026-10-01T12:00:01.000Z'
        }
      ])
    );

    const result = await migrateLegacyLocalStorage(db, storage);

    expect(result.status).toBe('completed');
    expect(result.suggestedStep).toBe(7);
    expect(result.importedQueueCount).toBe(1);

    // Check settings store
    const stepRecord = await withTransaction(
      db,
      TRAINING_STORES.settings,
      'readonly',
      async (s) => {
        return await reqToPromise(s[TRAINING_STORES.settings].get('suggestedStep'));
      }
    );
    expect(stepRecord).toEqual({
      key: 'suggestedStep',
      value: 7,
      source: 'legacy_import'
    });

    // Check old storage was NOT deleted
    expect(storage.has(CW_STORAGE_KEYS.lesson)).toBe(true);
    expect(storage.has(CW_STORAGE_KEYS.cwSettings)).toBe(true);
  });

  it('tolerates corrupt JSON in legacy settings or queue without aborting step migration', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CW_STORAGE_KEYS.lesson, '4');
    storage.setItem(CW_STORAGE_KEYS.cwSettings, '{ not-valid-json }');
    storage.setItem(CW_STORAGE_KEYS.progressQueue, 'corrupt-array');

    const result = await migrateLegacyLocalStorage(db, storage);

    expect(result.status).toBe('completed');
    expect(result.suggestedStep).toBe(4);
    expect(result.importedQueueCount).toBe(0);
  });

  it('is idempotent: re-running returns already-migrated without duplicating records', async () => {
    const storage = new MemoryStorage();
    storage.setItem(CW_STORAGE_KEYS.lesson, '5');

    const firstRun = await migrateLegacyLocalStorage(db, storage);
    expect(firstRun.status).toBe('completed');

    const secondRun = await migrateLegacyLocalStorage(db, storage);
    expect(secondRun.status).toBe('already-migrated');
    expect(secondRun.suggestedStep).toBe(5);
  });
});

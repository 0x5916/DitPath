/**
 * Safe migration of legacy localStorage state into the DitPath V2 database.
 *
 * Invariants:
 * - Preserves existing user lesson as `suggestedStep`, NEVER as verified character mastery.
 * - Never synthesizes fake character-level attempts or automaticity ratings.
 * - Preserves queued legacy progress summaries for future synchronization.
 * - Does not delete old localStorage keys during migration.
 * - Idempotent and safe to run repeatedly; transaction failure leaves retry possible.
 */

import { CW_STORAGE_KEYS } from '../storageKeys';
import { reqToPromise, withTransaction } from './training-db';
import { TRAINING_STORES } from './training-schema';

export interface StorageLike {
  getItem(key: string): string | null;
}

export interface LegacyMigrationResult {
  status: 'completed' | 'already-migrated' | 'no-storage';
  suggestedStep: number;
  importedQueueCount: number;
}

export const LEGACY_MIGRATION_META_KEY = 'migration_legacy_v1' as const;

export async function migrateLegacyLocalStorage(
  db: IDBDatabase,
  storage?: StorageLike | null
): Promise<LegacyMigrationResult> {
  // 1. Check if already migrated
  const alreadyMigrated = await withTransaction(
    db,
    TRAINING_STORES.meta,
    'readonly',
    async (stores) => {
      const record = await reqToPromise<{ key: string; completedAt: string } | undefined>(
        stores[TRAINING_STORES.meta].get(LEGACY_MIGRATION_META_KEY)
      );
      return Boolean(record?.completedAt);
    }
  );

  if (alreadyMigrated) {
    const existingStep = await withTransaction(
      db,
      TRAINING_STORES.settings,
      'readonly',
      async (stores) => {
        const record = await reqToPromise<{ key: string; value: number } | undefined>(
          stores[TRAINING_STORES.settings].get('suggestedStep')
        );
        return record?.value ?? 1;
      }
    );

    return {
      status: 'already-migrated',
      suggestedStep: existingStep,
      importedQueueCount: 0
    };
  }

  // Resolve storage object
  const targetStorage: StorageLike | null =
    storage !== undefined ? storage : typeof localStorage !== 'undefined' ? localStorage : null;

  if (!targetStorage) {
    return {
      status: 'no-storage',
      suggestedStep: 1,
      importedQueueCount: 0
    };
  }

  // 2. Read legacy lesson
  let suggestedStep = 1;
  const rawLesson = targetStorage.getItem(CW_STORAGE_KEYS.lesson);
  if (rawLesson) {
    const parsed = parseInt(rawLesson, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 40) {
      suggestedStep = parsed;
    }
  }

  // 3. Read legacy CW settings
  let legacySettings: Record<string, unknown> | null = null;
  const rawSettings = targetStorage.getItem(CW_STORAGE_KEYS.cwSettings);
  if (rawSettings) {
    try {
      const parsed = JSON.parse(rawSettings) as unknown;
      if (parsed && typeof parsed === 'object') {
        legacySettings = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt settings ignored safely
    }
  }

  // 4. Read legacy progress queue
  let legacyQueue: unknown[] = [];
  const rawQueue = targetStorage.getItem(CW_STORAGE_KEYS.progressQueue);
  if (rawQueue) {
    try {
      const parsed = JSON.parse(rawQueue) as unknown;
      if (Array.isArray(parsed)) {
        legacyQueue = parsed;
      }
    } catch {
      // Corrupt queue ignored safely
    }
  }

  // 5. Commit migration in a single atomic transaction across settings and meta stores
  await withTransaction(
    db,
    [TRAINING_STORES.settings, TRAINING_STORES.meta],
    'readwrite',
    async (stores) => {
      // Save suggested step
      await reqToPromise(
        stores[TRAINING_STORES.settings].put({
          key: 'suggestedStep',
          value: suggestedStep,
          source: 'legacy_import'
        })
      );

      // Save legacy settings if present
      if (legacySettings) {
        await reqToPromise(
          stores[TRAINING_STORES.settings].put({
            key: 'cwSettings',
            value: legacySettings,
            source: 'legacy_import'
          })
        );
      }

      // Save legacy queue if present
      if (legacyQueue.length > 0) {
        await reqToPromise(
          stores[TRAINING_STORES.settings].put({
            key: 'legacyProgressQueue',
            queue: legacyQueue,
            source: 'legacy_import'
          })
        );
      }

      // Mark migration completed
      await reqToPromise(
        stores[TRAINING_STORES.meta].put({
          key: LEGACY_MIGRATION_META_KEY,
          completedAt: new Date().toISOString(),
          suggestedStep,
          importedQueueCount: legacyQueue.length
        })
      );
    }
  );

  return {
    status: 'completed',
    suggestedStep,
    importedQueueCount: legacyQueue.length
  };
}

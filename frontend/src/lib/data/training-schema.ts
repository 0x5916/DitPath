/**
 * Versioned schema and object store definitions for the DitPath local training database.
 */

export const TRAINING_DB_NAME = 'morsestep_training_v1' as const;
export const TRAINING_DB_VERSION = 2 as const;

export const TRAINING_STORES = {
  attempts: 'attempts',
  sessions: 'sessions',
  mastery: 'mastery',
  outbox: 'outbox',
  settings: 'settings',
  meta: 'meta'
} as const;

export const OWNED_STORES = {
  attempts: 'owned_attempts',
  sessions: 'owned_sessions',
  mastery: 'owned_mastery',
  outbox: 'owned_outbox',
  meta: 'owned_meta',
  imports: 'history_imports'
} as const;

export type TrainingStoreName =
  | (typeof TRAINING_STORES)[keyof typeof TRAINING_STORES]
  | (typeof OWNED_STORES)[keyof typeof OWNED_STORES];

/**
 * Executes schema creation and migrations transaction-safely inside onupgradeneeded.
 */
export function upgradeTrainingDatabase(
  db: IDBDatabase,
  oldVersion: number,
  transaction?: IDBTransaction
): void {
  if (oldVersion < 1) {
    // 1. Attempts: immutable record of every prompt response
    if (!db.objectStoreNames.contains(TRAINING_STORES.attempts)) {
      const attemptStore = db.createObjectStore(TRAINING_STORES.attempts, {
        keyPath: 'id'
      });
      attemptStore.createIndex('sessionId', 'sessionId', { unique: false });
      attemptStore.createIndex('targetCharacter', 'targetCharacter', {
        unique: false
      });
      attemptStore.createIndex('createdAt', 'createdAt', { unique: false });
    }

    // 2. Sessions: records of guided training sessions
    if (!db.objectStoreNames.contains(TRAINING_STORES.sessions)) {
      const sessionStore = db.createObjectStore(TRAINING_STORES.sessions, {
        keyPath: 'id'
      });
      sessionStore.createIndex('step', 'step', { unique: false });
      sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
    }

    // 3. Mastery: derived character-level automaticity and review status
    if (!db.objectStoreNames.contains(TRAINING_STORES.mastery)) {
      const masteryStore = db.createObjectStore(TRAINING_STORES.mastery, {
        keyPath: 'character'
      });
      masteryStore.createIndex('status', 'status', { unique: false });
      masteryStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    // 4. Outbox: pending events to sync with the server
    if (!db.objectStoreNames.contains(TRAINING_STORES.outbox)) {
      const outboxStore = db.createObjectStore(TRAINING_STORES.outbox, {
        keyPath: 'eventId'
      });
      outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
    }

    // 5. Settings: client-side learning preferences & audio overrides
    if (!db.objectStoreNames.contains(TRAINING_STORES.settings)) {
      db.createObjectStore(TRAINING_STORES.settings, { keyPath: 'key' });
    }

    // 6. Meta: migrations, last sync timestamps, schema markers
    if (!db.objectStoreNames.contains(TRAINING_STORES.meta)) {
      db.createObjectStore(TRAINING_STORES.meta, { keyPath: 'key' });
    }
  }
  if (oldVersion < 2) {
    const attempts = db.createObjectStore(OWNED_STORES.attempts, { keyPath: ['ownerKey', 'id'] });
    for (const field of ['sessionId', 'targetCharacter', 'createdAt']) {
      attempts.createIndex(field, ['ownerKey', field]);
    }
    attempts.createIndex('ownerKey', 'ownerKey');
    const sessions = db.createObjectStore(OWNED_STORES.sessions, { keyPath: ['ownerKey', 'id'] });
    sessions.createIndex('startedAt', ['ownerKey', 'startedAt']);
    sessions.createIndex('ownerKey', 'ownerKey');
    db.createObjectStore(OWNED_STORES.mastery, { keyPath: ['ownerKey', 'character'] });
    const outbox = db.createObjectStore(OWNED_STORES.outbox, {
      keyPath: ['ownerKey', 'kind', 'id']
    });
    outbox.createIndex('ownerKey', 'ownerKey');
    db.createObjectStore(OWNED_STORES.meta, { keyPath: ['ownerKey', 'key'] });
    db.createObjectStore(OWNED_STORES.imports, { keyPath: ['installationId', 'kind', 'id'] });
    // Keep the original stores as an archive. Their ownership cannot be inferred.
    // The old queue is intentionally not copied into an account upload outbox.
    if (transaction)
      for (const name of ['attempts', 'sessions'] as const) {
        const request = transaction.objectStore(TRAINING_STORES[name]).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          transaction
            .objectStore(OWNED_STORES[name])
            .put({ ...cursor.value, ownerKey: 'unclaimed' });
          cursor.continue();
        };
      }
  }
}

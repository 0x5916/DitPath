/**
 * Native IndexedDB foundation for DitPath local storage.
 *
 * Guarantees:
 * - Safe for SSR / prerender: never attempts browser IndexedDB access if unavailable.
 * - Versioned transactions and upgrade handling.
 * - Typed transaction runner with automatic commit/abort safety.
 * - Test seam: supports injected IDBFactory (e.g. fake-indexeddb).
 */

import {
  TRAINING_DB_NAME,
  TRAINING_DB_VERSION,
  upgradeTrainingDatabase,
  type TrainingStoreName
} from './training-schema';

export function isIndexedDbAvailable(customFactory?: IDBFactory): boolean {
  if (customFactory) return true;
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function getIndexedDbFactory(customFactory?: IDBFactory): IDBFactory {
  if (customFactory) return customFactory;
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  throw new Error('IndexedDB is not available in the current environment (e.g. SSR/prerender).');
}

/**
 * Opens or upgrades the DitPath training database.
 */
export function openTrainingDb(customFactory?: IDBFactory): Promise<IDBDatabase> {
  const factory = getIndexedDbFactory(customFactory);

  return new Promise((resolve, reject) => {
    const request = factory.open(TRAINING_DB_NAME, TRAINING_DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result;
      upgradeTrainingDatabase(db, event.oldVersion);
    };

    request.onsuccess = () => {
      const db = request.result;
      // Close automatically if another tab or version requests an upgrade
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open DitPath training database'));
    };

    request.onblocked = () => {
      reject(new Error('IndexedDB database upgrade blocked by active connection'));
    };
  });
}

/**
 * Promisifies an IDBRequest.
 */
export function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Executes a scoped transaction across one or more stores.
 */
export async function withTransaction<T>(
  db: IDBDatabase,
  storeNames: TrainingStoreName | TrainingStoreName[],
  mode: IDBTransactionMode,
  fn: (stores: Record<string, IDBObjectStore>, tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const tx = db.transaction(names, mode);

  const storeMap: Record<string, IDBObjectStore> = {};
  for (const name of names) {
    storeMap[name] = tx.objectStore(name);
  }

  try {
    const result = await fn(storeMap, tx);
    return result;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // Ignore if transaction already settled
    }
    throw err;
  }
}

/**
 * Deletes the database (used in testing and explicit user data reset).
 */
export function deleteTrainingDb(customFactory?: IDBFactory): Promise<void> {
  const factory = getIndexedDbFactory(customFactory);

  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(TRAINING_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete database'));
    request.onblocked = () => reject(new Error('Database deletion blocked'));
  });
}

export function closeTrainingDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Harmless if already closed
  }
}

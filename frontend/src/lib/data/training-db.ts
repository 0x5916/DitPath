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
    let abandoned = false;

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = request.result;
      upgradeTrainingDatabase(db, event.oldVersion);
    };

    request.onsuccess = () => {
      const db = request.result;
      // A blocked request cannot be cancelled and may still open after rejection.
      if (abandoned) {
        db.close();
        return;
      }
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
      abandoned = true;
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
 * Only await IndexedDB requests inside fn; unrelated async work can allow an
 * idle transaction to commit before the callback finishes.
 */
export async function withTransaction<T>(
  db: IDBDatabase,
  storeNames: TrainingStoreName | TrainingStoreName[],
  mode: IDBTransactionMode,
  fn: (stores: Record<string, IDBObjectStore>, tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const tx = db.transaction(names, mode);
  // Observe the terminal event immediately, even while the callback is pending.
  // An outcome rather than a rejected promise avoids unhandled abort rejections.
  const finished = new Promise<DOMException | null>((resolve) => {
    tx.addEventListener('complete', () => resolve(null), { once: true });
    tx.addEventListener(
      'abort',
      () => resolve(tx.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError')),
      { once: true }
    );
  });

  const storeMap: Record<string, IDBObjectStore> = {};
  for (const name of names) {
    storeMap[name] = tx.objectStore(name);
  }

  try {
    const result = await fn(storeMap, tx);
    const error = await finished;
    if (error) throw error;
    return result;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // Ignore if transaction already settled
    }
    await finished;
    throw err;
  }
}

/**
 * Deletes the database (used in testing and explicit user data reset).
 */
export function deleteTrainingDb(
  customFactory?: IDBFactory,
  onBlocked?: () => void
): Promise<void> {
  const factory = getIndexedDbFactory(customFactory);

  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(TRAINING_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to delete database'));
    // Deletion requests cannot be cancelled. A blocked request can still succeed
    // after another tab closes, so report completion only on the terminal event.
    request.onblocked = () => onBlocked?.();
  });
}

export function closeTrainingDb(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Harmless if already closed
  }
}

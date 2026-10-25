import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  closeTrainingDb,
  deleteTrainingDb,
  isIndexedDbAvailable,
  openTrainingDb,
  TRAINING_DB_OPEN_TIMEOUT_MS,
  reqToPromise,
  withTransaction
} from './training-db';
import { TRAINING_DB_NAME, TRAINING_STORES } from './training-schema';

describe('IndexedDB Foundation (training-db)', () => {
  let fakeIndexedDB: IDBFactory;

  beforeEach(() => {
    // Isolated factories prevent a failed cleanup from blocking another test.
    fakeIndexedDB = new IDBFactory();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a stalled open at its deadline and allows a fresh retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(fakeIndexedDB, 'open').mockReturnValueOnce({} as IDBOpenDBRequest);
    const rejected = expect(openTrainingDb(fakeIndexedDB)).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(TRAINING_DB_OPEN_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);

    const db = await openTrainingDb(fakeIndexedDB);
    expect(vi.getTimerCount()).toBe(0);
    closeTrainingDb(db);
  });

  it('closes a connection that opens after the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const close = vi.fn();
    const request = { result: { close } } as unknown as IDBOpenDBRequest;
    vi.spyOn(fakeIndexedDB, 'open').mockReturnValueOnce(request);
    const rejected = expect(openTrainingDb(fakeIndexedDB)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(TRAINING_DB_OPEN_TIMEOUT_MS);
    await rejected;

    request.onsuccess?.call(request, new Event('success'));
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a late upgrade without running an abandoned migration', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const close = vi.fn();
    const createObjectStore = vi.fn();
    const abort = vi.fn();
    const request = { result: { close, createObjectStore } } as unknown as IDBOpenDBRequest;
    vi.spyOn(fakeIndexedDB, 'open').mockReturnValueOnce(request);
    const rejected = expect(openTrainingDb(fakeIndexedDB)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(TRAINING_DB_OPEN_TIMEOUT_MS);
    await rejected;

    Object.assign(request, { transaction: { abort } });
    request.onupgradeneeded?.call(
      request,
      Object.assign(new Event('upgradeneeded'), { oldVersion: 0 }) as IDBVersionChangeEvent
    );
    expect(abort).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(createObjectStore).not.toHaveBeenCalled();
  });

  it('aborts a pending upgrade when its open deadline expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const abort = vi.fn();
    const request = { transaction: { abort } } as unknown as IDBOpenDBRequest;
    vi.spyOn(fakeIndexedDB, 'open').mockReturnValueOnce(request);
    const rejected = expect(openTrainingDb(fakeIndexedDB)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(TRAINING_DB_OPEN_TIMEOUT_MS);
    await rejected;
    expect(abort).toHaveBeenCalledOnce();
  });

  it.each(['success', 'error', 'blocked'] as const)(
    'clears the open deadline on %s',
    async (event) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const db = { close: vi.fn() };
      const request = { result: db } as unknown as IDBOpenDBRequest;
      vi.spyOn(fakeIndexedDB, 'open').mockReturnValueOnce(request);
      const opened = openTrainingDb(fakeIndexedDB);
      const outcome =
        event === 'success' ? expect(opened).resolves.toBe(db) : expect(opened).rejects.toThrow();
      request[`on${event}`]?.call(
        request,
        Object.assign(new Event(event), { oldVersion: 1, newVersion: 2 }) as IDBVersionChangeEvent
      );
      await outcome;
      expect(vi.getTimerCount()).toBe(0);
    }
  );

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

  it('returns the callback value only after a multi-store commit completes', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    let committed = false;

    const result = await withTransaction(
      db,
      [TRAINING_STORES.settings, TRAINING_STORES.meta],
      'readwrite',
      async (stores, tx) => {
        tx.addEventListener('complete', () => (committed = true));
        await reqToPromise(stores.settings.put({ key: 'setting', value: 1 }));
        await reqToPromise(stores.meta.put({ key: 'marker', value: 2 }));
        expect(committed).toBe(false);
        return 'saved';
      }
    );

    expect(result).toBe('saved');
    expect(committed).toBe(true);
    const records = await withTransaction(
      db,
      [TRAINING_STORES.settings, TRAINING_STORES.meta],
      'readonly',
      async (stores) =>
        Promise.all([
          reqToPromise(stores.settings.get('setting')),
          reqToPromise(stores.meta.get('marker'))
        ])
    );
    expect(records).toEqual([
      { key: 'setting', value: 1 },
      { key: 'marker', value: 2 }
    ]);
    closeTrainingDb(db);
  });

  it('rejects an abort after a successful request and rolls back the write', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    await expect(
      withTransaction(db, TRAINING_STORES.settings, 'readwrite', async (stores, tx) => {
        const request = stores.settings.put({ key: 'late_abort', value: 1 });
        request.addEventListener('success', () => tx.abort());
        await reqToPromise(request);
        return 'request succeeded';
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    const record = await withTransaction(db, TRAINING_STORES.settings, 'readonly', (stores) =>
      reqToPromise(stores.settings.get('late_abort'))
    );
    expect(record).toBeUndefined();
    closeTrainingDb(db);
  });

  it('rejects a later queued request failure even when the callback already returned', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    await expect(
      withTransaction(db, TRAINING_STORES.settings, 'readwrite', async (stores) => {
        await reqToPromise(stores.settings.put({ key: 'duplicate', value: 1 }));
        stores.settings.add({ key: 'duplicate', value: 2 });
        return 'callback succeeded';
      })
    ).rejects.toMatchObject({ name: 'ConstraintError' });

    const count = await withTransaction(db, TRAINING_STORES.settings, 'readonly', (stores) =>
      reqToPromise(stores.settings.count())
    );
    expect(count).toBe(0);
    closeTrainingDb(db);
  });

  it('preserves the callback error and waits for cross-store rollback', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    const failure = new Error('Original callback failure');
    let aborted = false;
    await expect(
      withTransaction(
        db,
        [TRAINING_STORES.settings, TRAINING_STORES.meta],
        'readwrite',
        async (stores, tx) => {
          tx.addEventListener('abort', () => (aborted = true));
          await reqToPromise(stores.settings.put({ key: 'setting', value: 1 }));
          await reqToPromise(stores.meta.put({ key: 'marker', value: 2 }));
          throw failure;
        }
      )
    ).rejects.toBe(failure);

    expect(aborted).toBe(true);
    const counts = await withTransaction(
      db,
      [TRAINING_STORES.settings, TRAINING_STORES.meta],
      'readonly',
      async (stores) =>
        Promise.all([reqToPromise(stores.settings.count()), reqToPromise(stores.meta.count())])
    );
    expect(counts).toEqual([0, 0]);
    closeTrainingDb(db);
  });

  it('keeps the callback error when its transaction already completed', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    const failure = new Error('Failure after transaction completion');
    await expect(
      withTransaction(db, TRAINING_STORES.settings, 'readonly', async (_stores, tx) => {
        await new Promise<void>((resolve) => tx.addEventListener('complete', () => resolve()));
        throw failure;
      })
    ).rejects.toBe(failure);
    closeTrainingDb(db);
  });

  it.each(['readonly', 'readwrite'] as const)(
    'waits for an empty %s transaction to complete',
    async (mode) => {
      const db = await openTrainingDb(fakeIndexedDB);
      let committed = false;
      await withTransaction(db, TRAINING_STORES.settings, mode, async (_stores, tx) => {
        tx.addEventListener('complete', () => (committed = true));
      });
      expect(committed).toBe(true);
      closeTrainingDb(db);
    }
  );

  it('allows a recovered request error when the transaction successfully commits', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    await withTransaction(db, TRAINING_STORES.settings, 'readwrite', async (stores) => {
      await reqToPromise(stores.settings.put({ key: 'duplicate', value: 1 }));
      const duplicate = stores.settings.add({ key: 'duplicate', value: 2 });
      duplicate.addEventListener('error', (event) => event.preventDefault());
      await expect(reqToPromise(duplicate)).rejects.toMatchObject({ name: 'ConstraintError' });
      await reqToPromise(stores.settings.put({ key: 'recovered', value: 3 }));
    });

    const count = await withTransaction(db, TRAINING_STORES.settings, 'readonly', (stores) =>
      reqToPromise(stores.settings.count())
    );
    expect(count).toBe(2);
    closeTrainingDb(db);
  });

  it('rejects invalid store scope and readonly writes without hanging', async () => {
    const db = await openTrainingDb(fakeIndexedDB);
    await expect(withTransaction(db, [], 'readonly', async () => undefined)).rejects.toMatchObject({
      name: 'InvalidAccessError'
    });
    await expect(
      withTransaction(db, TRAINING_STORES.settings, 'readonly', async (stores) => {
        stores.settings.put({ key: 'forbidden', value: 1 });
      })
    ).rejects.toMatchObject({ name: 'ReadOnlyError' });
    closeTrainingDb(db);
  });

  it('closes its connection when another request needs a version change', async () => {
    await openTrainingDb(fakeIndexedDB);
    await deleteTrainingDb(fakeIndexedDB);
  });

  it('keeps blocked deletion pending until the blocking connection closes', async () => {
    const blocker = await openTrainingDb(fakeIndexedDB);
    blocker.onversionchange = null;
    let notifyBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => (notifyBlocked = resolve));
    let settled = false;
    const deletion = deleteTrainingDb(fakeIndexedDB, notifyBlocked).then(() => {
      settled = true;
    });

    await blocked;
    expect(settled).toBe(false);
    closeTrainingDb(blocker);
    await deletion;
    expect(settled).toBe(true);
  });

  it('closes a connection that opens after its blocked request was rejected', async () => {
    const blocker = await openTrainingDb(fakeIndexedDB);
    blocker.onversionchange = null;
    let request: IDBOpenDBRequest | undefined;
    // Force a future-version open to exercise the blocked upgrade lifecycle.
    const upgradingFactory = {
      open(name: string, version = 1) {
        request = fakeIndexedDB.open(name, version + 1);
        return request;
      }
    } as IDBFactory;

    await expect(openTrainingDb(upgradingFactory)).rejects.toThrow('upgrade blocked');
    const opened = new Promise<IDBDatabase>((resolve) => {
      request!.addEventListener('success', () => resolve(request!.result));
    });
    closeTrainingDb(blocker);
    const abandoned = await opened;
    expect(() => abandoned.transaction(TRAINING_STORES.settings)).toThrow();
    await reqToPromise(fakeIndexedDB.deleteDatabase(TRAINING_DB_NAME));
  });
});

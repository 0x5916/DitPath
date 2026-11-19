import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { restoreDeviceHistory, type DeviceDatabaseSnapshot } from './domain-recovery';
import { openTrainingDb, reqToPromise } from './training-db';
import { TRAINING_DB_NAME } from './training-schema';
import { LEARNING_EVIDENCE_DB_NAME, openLearningEvidenceDb } from './learning-evidence';

function preferences() {
  const entries = new Map<string, string>();
  return {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => entries.set(k, v)
  };
}
describe('same-browser domain recovery', () => {
  it('preserves ownership, guest checkpoints and unacknowledged uploads, without replay on retry', async () => {
    const factory = new IDBFactory();
    const storage = preferences();
    storage.setItem('theme', 'dark');
    const snapshots: DeviceDatabaseSnapshot[] = [
      {
        name: TRAINING_DB_NAME,
        version: 2,
        stores: {
          meta: [],
          owned_outbox: [{ ownerKey: 'account:ao', kind: 'session', id: 'local' }]
        }
      },
      {
        name: LEARNING_EVIDENCE_DB_NAME,
        version: 1,
        stores: {
          meta: [{ owner: 'unclaimed', key: 'checkpoint:copy', value: { draft: 'S' } }],
          records: [],
          outbox: []
        }
      }
    ];
    const data = {
      snapshots,
      preferences: [
        ['theme', 'light'],
        ['learn.lesson', '4']
      ] as [string, string][]
    };
    expect(await restoreDeviceHistory(data, storage, factory)).toBe(3);
    const training = await openTrainingDb(factory);
    const queue = training.transaction('owned_outbox', 'readwrite').objectStore('owned_outbox');
    const key = ['account:ao', 'session', 'local'];
    expect(await reqToPromise(queue.get(key))).toMatchObject({ ownerKey: 'account:ao' });
    await reqToPromise(queue.delete(key));
    expect(await restoreDeviceHistory(data, storage, factory)).toBe(0);
    expect(
      await reqToPromise(training.transaction('owned_outbox').objectStore('owned_outbox').count())
    ).toBe(0);
    training.close();
    const evidence = await openLearningEvidenceDb(factory);
    expect(
      await reqToPromise(
        evidence.transaction('meta').objectStore('meta').get(['unclaimed', 'checkpoint:copy'])
      )
    ).toMatchObject({ value: { draft: 'S' } });
    evidence.close();
    expect(storage.getItem('theme')).toBe('dark');
    expect(storage.getItem('learn.lesson')).toBe('4');
  });

  it('imports original v1 sessions as unclaimed and refuses conflicting existing records atomically', async () => {
    const factory = new IDBFactory();
    const storage = preferences();
    const db = await openTrainingDb(factory);
    const original = { ownerKey: 'unclaimed', id: 'session', value: 'original' };
    await reqToPromise(
      db.transaction('owned_sessions', 'readwrite').objectStore('owned_sessions').add(original)
    );
    const legacy = (value: string) => ({
      snapshots: [
        {
          name: TRAINING_DB_NAME,
          version: 1,
          stores: { attempts: [], sessions: [{ id: 'other' }, { id: 'session', value }], meta: [] }
        }
      ],
      preferences: []
    });
    await expect(restoreDeviceHistory(legacy('different'), storage, factory)).rejects.toThrow(
      'conflict'
    );
    const sessions = () =>
      reqToPromise(db.transaction('owned_sessions').objectStore('owned_sessions').getAll());
    expect(await sessions()).toEqual([original]);
    await restoreDeviceHistory(legacy('original'), storage, factory);
    expect(await sessions()).toEqual([{ id: 'other', ownerKey: 'unclaimed' }, original]);
    db.close();
  });

  it('rejects unrecognized databases and credential keys', async () => {
    const storage = preferences();
    await expect(
      restoreDeviceHistory(
        { snapshots: [], preferences: [['refresh_token', 'fixture']] },
        storage,
        new IDBFactory()
      )
    ).rejects.toThrow('invalid');
    await expect(
      restoreDeviceHistory(
        { snapshots: [{ name: 'unknown', version: 1, stores: {} }], preferences: [] },
        storage,
        new IDBFactory()
      )
    ).rejects.toThrow('invalid');
    expect(storage.getItem('refresh_token')).toBeNull();
  });
});

it('copies later offline additions without replaying a previously consumed upload', async () => {
  const factory = new IDBFactory();
  const storage = preferences();
  const pending = {
    ownerKey: 'account:a',
    kind: 'session',
    id: 'first',
    payloadKey: 'original',
    retryCount: 0
  };
  const stores = {
    meta: [],
    owned_outbox: [pending],
    owned_sessions: [{ ownerKey: 'unclaimed', id: 'first' }]
  };
  const data = { snapshots: [{ name: TRAINING_DB_NAME, version: 2, stores }], preferences: [] };
  expect(await restoreDeviceHistory(data, storage, factory)).toBe(2);
  const db = await openTrainingDb(factory);
  await reqToPromise(
    db.transaction('owned_outbox', 'readwrite').objectStore('owned_outbox').clear()
  );
  pending.retryCount++;
  stores.owned_sessions.push({ ownerKey: 'unclaimed', id: 'later' });
  expect(await restoreDeviceHistory(data, storage, factory)).toBe(1);
  expect(
    await reqToPromise(db.transaction('owned_outbox').objectStore('owned_outbox').count())
  ).toBe(0);
  db.close();
});

it('checks ownership across databases before writing any history', async () => {
  const factory = new IDBFactory();
  const storage = preferences();
  const db = await openLearningEvidenceDb(factory);
  const current = { owner: 'unclaimed', key: 'import-owner', value: 'account:current' };
  await reqToPromise(db.transaction('meta', 'readwrite').objectStore('meta').add(current));
  const snapshots: DeviceDatabaseSnapshot[] = [
    {
      name: TRAINING_DB_NAME,
      version: 2,
      stores: { meta: [], owned_sessions: [{ ownerKey: 'unclaimed', id: 'legacy' }] }
    },
    {
      name: LEARNING_EVIDENCE_DB_NAME,
      version: 1,
      stores: { meta: [], records: [{ owner: 'unclaimed', id: 'unassigned' }], outbox: [] }
    }
  ];
  await expect(
    restoreDeviceHistory({ snapshots, preferences: [] }, storage, factory)
  ).rejects.toThrow('conflict');
  const training = await openTrainingDb(factory);
  expect(
    await reqToPromise(training.transaction('owned_sessions').objectStore('owned_sessions').count())
  ).toBe(0);
  await reqToPromise(
    db.transaction('meta', 'readwrite').objectStore('meta').delete(['unclaimed', 'import-owner'])
  );
  expect(await restoreDeviceHistory({ snapshots, preferences: [] }, storage, factory)).toBe(2);
  db.close();
  training.close();
});

it('accepts the same synchronized evidence with another local capture order', async () => {
  const factory = new IDBFactory();
  const db = await openLearningEvidenceDb(factory);
  const record = {
    id: 'observation',
    kind: 'observation',
    policy_version: 'learning-policy-1.0',
    recorded_at: '2026-10-10T12:00:00Z'
  };
  const row = { owner: 'account:a', id: record.id, record, order: 1, processId: 'source' };
  const existing = { ...row, order: 3, processId: 'destination' };
  await reqToPromise(db.transaction('records', 'readwrite').objectStore('records').add(existing));
  await restoreDeviceHistory(
    {
      snapshots: [
        {
          name: LEARNING_EVIDENCE_DB_NAME,
          version: 1,
          stores: { meta: [], records: [row], outbox: [] }
        }
      ],
      preferences: []
    },
    preferences(),
    factory
  );
  expect(await reqToPromise(db.transaction('records').objectStore('records').getAll())).toEqual([
    existing
  ]);
  db.close();
});

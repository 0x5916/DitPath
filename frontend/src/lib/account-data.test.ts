import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { apiFetch } from './auth';
import { clearDeletedAccountData, requestTrainingData, resetAccountProgress } from './account-data';
import { trainingEpochKey, getTrainingOwner } from './training-owner';
import { CW_STORAGE_KEYS } from './storageKeys';
import { openTrainingDb, reqToPromise, withTransaction } from './data/training-db';
import { OWNED_STORES } from './data/training-schema';
import { openLearningPilotDb } from './data/learning-pilot';
import { openLearningEvidenceDb } from './data/learning-evidence';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  foreignId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner = `account:${id}`,
  later = `${owner}:2`,
  other = `account:${foreignId}`;
vi.mock('./auth', () => ({
  getAuthAccountId: () => id,
  getAuthSession: () => ({ generation: 1 }),
  assertAuthSessionCurrent: vi.fn(),
  apiFetch: vi.fn()
}));
const preference = `${CW_STORAGE_KEYS.cwSettings}.account.${id}`;
const peerPreference = `${CW_STORAGE_KEYS.cwSettings}.account.${foreignId}`;
const openDb = [openTrainingDb, openLearningPilotDb, openLearningEvidenceDb];
const owned = [
  [
    OWNED_STORES.attempts,
    OWNED_STORES.sessions,
    OWNED_STORES.outbox,
    OWNED_STORES.mastery,
    OWNED_STORES.meta
  ],
  ['sessions', 'attempts'],
  ['records', 'outbox', 'meta']
];
let dbs: IDBDatabase[];
async function rows(db: IDBDatabase, name: string) {
  return withTransaction(db, name, 'readonly', (s) => reqToPromise(s[name].getAll()));
}
async function expectOwners(remaining: string[]) {
  for (const [i, db] of dbs.entries()) {
    for (const name of owned[i]) {
      const records = (await rows(db, name)).filter((r) => r.key === 'checkpoint:copy');
      expect(records.map((r) => r.owner ?? r.ownerKey).sort(), `${db.name} / ${name}`).toEqual(
        [...remaining].sort()
      );
    }
  }
}
async function put(db: IDBDatabase, store: string, record: object) {
  await withTransaction(db, store, 'readwrite', (s) => reqToPromise(s[store].put(record)));
}
beforeEach(async () => {
  vi.mocked(apiFetch).mockReset();
  const values: Record<string, string> = {};
  const storage = Object.assign(values, {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
    removeItem: (key: string) => {
      delete values[key];
    }
  });
  storage.setItem(preference, 'mine');
  storage.setItem(peerPreference, 'theirs');
  storage.setItem('theme', 'dark');
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { indexedDB: new IDBFactory(), localStorage: storage })
  );
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  dbs = await Promise.all(openDb.map((open) => open()));
  for (const [i, db] of dbs.entries()) {
    for (const key of [owner, later, other, 'unclaimed']) {
      for (const name of owned[i]) {
        await put(db, name, {
          owner: key,
          ownerKey: key,
          key: 'checkpoint:copy',
          kind: 'session',
          character: 'K',
          id: 'row'
        });
      }
    }
  }
  for (const [key, tag] of [
    [owner, 'a'],
    [other, 'b']
  ]) {
    await put(dbs[0], OWNED_STORES.imports, {
      installationId: 'install',
      kind: 'attempt',
      id: tag,
      ownerKey: key
    });
    await put(dbs[2], 'meta', { owner: 'unclaimed', key: `import:${tag}`, value: key });
  }
  await put(dbs[2], 'meta', { owner: 'unclaimed', key: 'import-owner', value: owner });
});
afterEach(() => {
  dbs.forEach((db) => db.close());
  vi.unstubAllGlobals();
});
const response = (status: number, epoch?: number) =>
  new Response(null, {
    status,
    headers: epoch ? { 'X-Training-Epoch': String(epoch) } : undefined
  });

it('clears only the confirmed generation including pending work and keeps user preferences and guest import assignments', async () => {
  vi.mocked(apiFetch).mockResolvedValue(response(204, 2));
  await resetAccountProgress(new AbortController().signal);
  expect(getTrainingOwner()).toBe(later);
  await expectOwners([later, other, 'unclaimed']);
  expect(localStorage.getItem(preference)).toBe('mine');
  expect((await rows(dbs[0], OWNED_STORES.imports)).map((r) => r.id)).toEqual(['a', 'b']);
  expect((await rows(dbs[2], 'meta')).find((r) => r.key === 'import-owner')?.value).toBe(owner);
});
it.each([403, 500, 204, 409])(
  'retains local data when the reset returns %s without a new epoch',
  async (status) => {
    vi.mocked(apiFetch).mockResolvedValue(response(status));
    await expect(resetAccountProgress(new AbortController().signal)).rejects.toThrow();
    await expectOwners([owner, later, other, 'unclaimed']);
    expect(getTrainingOwner()).toBe(owner);
  }
);
it('adopts a reset performed elsewhere, rejects a stale write, and requires a new confirmation', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(response(409, 2));
  await expect(resetAccountProgress(new AbortController().signal)).rejects.toThrow();
  expect(getTrainingOwner()).toBe(later);
  await expect(
    requestTrainingData(owner, '/training/events/batch', { method: 'POST' })
  ).rejects.toThrow();
  expect(apiFetch).toHaveBeenCalledTimes(1);
  vi.mocked(apiFetch).mockResolvedValueOnce(response(200, 2));
  await requestTrainingData(later, '/training/events/batch', { method: 'POST' });
  expect(new Headers(vi.mocked(apiFetch).mock.calls[1][1]?.headers).get('X-Training-Epoch')).toBe(
    '2'
  );
  await expectOwners([later, other, 'unclaimed']);
});
it('reconciles a changed generation discovered on an ordinary sync request', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(response(200, 2));
  await expect(requestTrainingData(owner, '/training/changes')).rejects.toThrow();
  expect(getTrainingOwner()).toBe(later);
  await expectOwners([later, other, 'unclaimed']);
});
it('recovers from a local storage failure after server commit without repeating the reset', async () => {
  vi.spyOn(window.indexedDB, 'open').mockImplementationOnce(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  vi.mocked(apiFetch).mockResolvedValueOnce(response(204, 2));
  await expect(resetAccountProgress(new AbortController().signal)).rejects.toThrow();
  expect(getTrainingOwner()).toBe(owner);
  vi.mocked(apiFetch).mockResolvedValueOnce(response(200, 2));
  await expect(requestTrainingData(owner, '/training/changes')).rejects.toThrow();
  expect(getTrainingOwner()).toBe(later);
  expect(
    vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'DELETE')
  ).toHaveLength(1);
  await expectOwners([later, other, 'unclaimed']);
});
it('erases every deleted-account generation, dedicated preferences, and its guest journals', async () => {
  localStorage.setItem(trainingEpochKey(id), '2');
  await clearDeletedAccountData(later);
  await expectOwners([other, 'unclaimed']);
  expect((await rows(dbs[0], OWNED_STORES.imports)).map((r) => r.id)).toEqual(['b']);
  expect(
    (await rows(dbs[2], 'meta')).filter((r) => r.key.startsWith('import')).map((r) => r.key)
  ).toEqual(['import:b']);
  expect(localStorage.getItem(preference)).toBeNull();
  expect(localStorage.getItem(trainingEpochKey(id))).toBeNull();
  expect(localStorage.getItem(peerPreference)).toBe('theirs');
  expect(localStorage.getItem('theme')).toBe('dark');
});

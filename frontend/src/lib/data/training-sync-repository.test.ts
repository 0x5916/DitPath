import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPendingTrainingPersistence } from '../pending-training-persistence';
import { IDBFactory } from 'fake-indexeddb';
import type { AttemptEvent, TrainingSessionRecord } from '../training/v2/types';
import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import {
  clearTrainingCache,
  closeTrainingDb,
  openTrainingDb,
  reqToPromise,
  withTransaction
} from './training-db';
import { OWNED_STORES, TRAINING_DB_NAME, TRAINING_STORES } from './training-schema';
import {
  createTrainingSyncRepository,
  getTrainingInstallationId,
  subscribeTrainingDataChanges
} from './training-sync-repository';

vi.mock('../pending-training-persistence', () => ({
  hasPendingTrainingPersistence: vi.fn(() => false)
}));
const account = 'account:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'account:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const attempt: AttemptEvent = {
  schemaVersion: 1,
  id: 'attempt',
  sessionId: 'session',
  promptId: 'prompt',
  promptKind: 'recall',
  targetCharacter: 'K',
  enteredText: 'K',
  isCorrect: true,
  classification: 'automatic',
  latencyMs: 1000,
  replayCount: 0,
  inputMode: 'keyboard',
  charWpm: 20,
  effWpm: 12,
  freqHz: 600,
  createdAt: '2026-10-20T00:01:00.000Z'
};
const session: TrainingSessionRecord = {
  schemaVersion: 1,
  id: 'session',
  mode: 'guided',
  step: 1,
  charWpm: 20,
  effWpm: 12,
  freqHz: 600,
  startedAt: '2026-10-20T00:00:00.000Z',
  status: 'in-progress',
  promptCount: 12,
  completedPromptCount: 0
};
describe('Owner-scoped training persistence', () => {
  let db: IDBDatabase;
  let factory: IDBFactory;
  beforeEach(async () => {
    vi.mocked(hasPendingTrainingPersistence).mockReturnValue(false);
    factory = new IDBFactory();
    db = await openTrainingDb(factory);
  });
  afterEach(() => closeTrainingDb(db));
  it('isolates every query and allows identical IDs in separate owners', async () => {
    const left = createAttemptRepository(db, account);
    const right = createAttemptRepository(db, other);
    await left.saveAttempt(attempt);
    await right.saveAttempt({ ...attempt, enteredText: 'M' });
    expect((await left.getAttempt('attempt'))?.enteredText).toBe('K');
    expect((await right.getAttempt('attempt'))?.enteredText).toBe('M');
    expect(await createAttemptRepository(db).countAttempts()).toBe(0);
    expect(await left.getAttemptsBySession('session')).toHaveLength(1);
    expect(await left.getAttemptsByCharacter('K')).toHaveLength(1);
    expect(
      await left.getAttemptsByTimeRange(session.startedAt, '2027-01-01T00:00:00Z')
    ).toHaveLength(1);
    await createSessionRepository(db, account).saveSession(session);
    expect(await createSessionRepository(db, other).getSessions()).toEqual([]);
    expect(await createSessionRepository(db).getLatestInProgressSession()).toBeNull();
  });
  it('atomically commits attempt, prompt count and frozen outbox and tolerates lost responses', async () => {
    const sessions = createSessionRepository(db, account);
    const attempts = createAttemptRepository(db, account);
    const sync = createTrainingSyncRepository(db, account);
    await sessions.saveSession(session);
    await attempts.saveAttempt(attempt);
    await attempts.saveAttempt(attempt);
    expect((await sessions.getSession('session'))?.completedPromptCount).toBe(1);
    expect(await sync.countPending()).toBe(1);
    await expect(attempts.saveAttempt({ ...attempt, latencyMs: 1 })).rejects.toThrow(
      'Immutable attempt conflict'
    );
    const sent = (await sync.getPending())[0];
    await createTrainingSyncRepository(db, other).acknowledge([sent]);
    await sync.acknowledge([{ ...sent, payloadKey: 'different' }]);
    expect(await sync.countPending()).toBe(1);
    await sync.acknowledge([sent]);
    await sync.acknowledge([sent]);
    expect(await sync.countPending()).toBe(0);
    expect(await attempts.countAttempts()).toBe(1);
  });
  it('rolls back new sibling evidence and counts when an atomic batch conflicts', async () => {
    const attempts = createAttemptRepository(db, account);
    await createSessionRepository(db, account).saveSession(session);
    await attempts.saveAttempt(attempt);
    await expect(
      attempts.saveAttempts([
        { ...attempt, id: 'new' },
        { ...attempt, latencyMs: 1 }
      ])
    ).rejects.toThrow('Immutable');
    expect(await attempts.getAttempt('new')).toBeNull();
    expect(
      (await createSessionRepository(db, account).getSession('session'))?.completedPromptCount
    ).toBe(1);
  });
  it('freezes unmeasured evidence in terminal manifests and preserves failed dependencies', async () => {
    const sessions = createSessionRepository(db, account);
    const attempts = createAttemptRepository(db, account);
    const sync = createTrainingSyncRepository(db, account);
    await sessions.saveSession(session);
    await attempts.saveAttempts([
      attempt,
      { ...attempt, id: 'match', promptKind: 'unscored-match', classification: 'unmeasured' }
    ]);
    await sessions.updateSessionProgress('session', 12, 'completed', '2026-10-20T00:03:00.000Z');
    const terminal = (await sync.getPending('session'))[0];
    expect(terminal.payload).toMatchObject({
      eventIds: ['attempt', 'match'],
      completedPromptCount: 12
    });
    expect(await sync.getSessionDependencies(terminal)).toEqual({ pending: true });
    await sync.reject((await sync.getPending('attempt'))[0], 'ID_CONFLICT', true);
    expect(await sync.getSessionDependencies(terminal)).toEqual({
      pending: true,
      permanentError: 'ID_CONFLICT'
    });
    await expect(attempts.saveAttempt({ ...attempt, id: 'late' })).rejects.toThrow(
      'finalized session'
    );
    await expect(sessions.updateSessionProgress('session', 11, 'completed')).rejects.toThrow(
      'Immutable session conflict'
    );
    await expect(sessions.saveSession(session)).rejects.toThrow('Immutable session conflict');
  });
  it('retains permanent failures without blocking siblings or allowing cache loss', async () => {
    const sync = createTrainingSyncRepository(db, account);
    await createAttemptRepository(db, account).saveAttempts([
      attempt,
      { ...attempt, id: 'sibling' }
    ]);
    await sync.reject((await sync.getPending())[0], 'ID_CONFLICT', true);
    expect(await sync.getPending()).toHaveLength(1);
    expect(await sync.getFailures()).toHaveLength(1);
    expect(await sync.countPending()).toBe(2);
    await expect(sync.clearDownloadedCache()).rejects.toThrow('Pending training uploads');
    await expect(clearTrainingCache(db)).rejects.toThrow('Pending training uploads');
  });

  it('stores guided accuracy atomically with its frozen metadata and excludes unmeasured evidence', async () => {
    const sessions = createSessionRepository(db, account);
    const attempts = createAttemptRepository(db, account);
    const sync = createTrainingSyncRepository(db, account);
    await sessions.saveSession(session);
    await attempts.saveAttempts([
      attempt,
      { ...attempt, id: 'wrong-1', isCorrect: false, classification: 'incorrect' },
      { ...attempt, id: 'wrong-2', isCorrect: false, classification: 'incorrect' },
      { ...attempt, id: 'matching', classification: 'unmeasured' }
    ]);
    await sessions.updateSessionProgress('session', 12, 'completed', '2026-10-20T00:03:00.000Z');
    expect((await sessions.getSession('session'))?.accuracy).toBe(0.333);
    expect((await sync.getPending('session'))[0].payload).toMatchObject({ accuracy: 0.333 });
    await sessions.saveSession({
      ...session,
      status: 'completed',
      completedPromptCount: 12,
      completedAt: '2026-10-20T00:03:00.000Z'
    });
    await sessions.saveSession({ ...session, id: 'no-score', status: 'abandoned' });
    expect((await sessions.getSession('no-score'))?.accuracy).toBeUndefined();
    await sessions.saveSession({
      ...session,
      id: 'practice-score',
      mode: 'practice',
      status: 'completed',
      completedAt: '2026-10-20T00:03:00.000Z',
      promptCount: 1,
      completedPromptCount: 1,
      accuracy: 0.875
    });
    expect((await sessions.getSession('practice-score'))?.accuracy).toBe(0.875);
  });
  it('downloads atomically, preserves pending local content, and rejects stale cursor pages', async () => {
    const sync = createTrainingSyncRepository(db, account);
    const attempts = createAttemptRepository(db, account);
    await attempts.saveAttempt(attempt);
    await sync.applyDownloadPage({
      attempts: [
        { ...attempt, enteredText: 'conflict' },
        { ...attempt, id: 'remote' }
      ],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'checkpoint'
    });
    expect((await attempts.getAttempt('attempt'))?.enteredText).toBe('K');
    expect(await attempts.getAttempt('remote')).not.toBeNull();
    expect(await sync.countPending()).toBe(1);
    expect(await sync.getCursor()).toBe('checkpoint');
    expect(await createTrainingSyncRepository(db, other).getCursor()).toBeNull();
    await expect(
      sync.applyDownloadPage({
        attempts: [],
        sessions: [],
        expectedCursor: null,
        nextCursor: 'stale'
      })
    ).rejects.toThrow('cursor changed');
    expect(await sync.getCursor()).toBe('checkpoint');
  });
  it('rolls back partial downloads and the cursor on interruption, then replays safely', async () => {
    const sync = createTrainingSyncRepository(db, account);
    await expect(
      sync.applyDownloadPage({
        attempts: [attempt],
        sessions: [{ ...session, id: undefined } as unknown as TrainingSessionRecord],
        expectedCursor: null,
        nextCursor: 'bad'
      })
    ).rejects.toMatchObject({ name: 'DataError' });
    expect(await createAttemptRepository(db, account).countAttempts()).toBe(0);
    expect(await sync.getCursor()).toBeNull();
    await sync.applyDownloadPage({
      attempts: [attempt],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'good'
    });
    expect(await sync.getCursor()).toBe('good');
    expect(await sync.countPending()).toBe(0);
  });
  it('preserves nullable legacy measurements without exposing them as resumable lessons', async () => {
    const sync = createTrainingSyncRepository(db, account);
    await sync.applyDownloadPage({
      attempts: [],
      sessions: [
        {
          schemaVersion: 1,
          id: 'legacy:row',
          mode: 'legacy',
          step: 3,
          accuracy: null,
          status: 'completed',
          sourceKind: 'legacy_v1',
          startedAt: null,
          completedAt: null,
          charWpm: null,
          effWpm: null,
          freqHz: null,
          promptCount: null,
          completedPromptCount: null,
          occurredAt: '2026-10-20T00:00:00.000Z'
        }
      ],
      expectedCursor: null,
      nextCursor: 'legacy'
    });
    const sessions = createSessionRepository(db, account);
    expect(await sessions.getLatestInProgressSession()).toBeNull();
    expect(await sessions.getSession('legacy:row')).toBeNull();
    expect((await sessions.getSessions())[0]).toMatchObject({
      mode: 'legacy',
      startedAt: null,
      accuracy: null
    });
  });
  it('imports explicitly to one account, repeats safely, and leaves interrupted end times unknown', async () => {
    await createSessionRepository(db).saveSession(session);
    await createAttemptRepository(db).saveAttempt(attempt);
    const left = createTrainingSyncRepository(db, account);
    const right = createTrainingSyncRepository(db, other);
    expect(await left.countPending()).toBe(0);
    expect(await left.getUnclaimedCount()).toBe(2);
    const installation = await getTrainingInstallationId(db);
    expect(await getTrainingInstallationId(db)).toBe(installation);
    expect(await left.importUnclaimed(installation)).toBe(2);
    expect(await left.importUnclaimed(installation)).toBe(0);
    expect(await right.importUnclaimed(installation)).toBe(0);
    expect(await left.getUnclaimedCount()).toBe(0);
    expect(await left.countPending()).toBe(2);
    expect(await right.countPending()).toBe(0);
    const imported = await createSessionRepository(db, account).getSession('session');
    expect(imported).toMatchObject({ status: 'abandoned', eventIds: ['attempt'] });
    expect(imported?.completedAt).toBeUndefined();
    expect(await createAttemptRepository(db).countAttempts()).toBe(1);
  });
  it('cache clearing preserves unclaimed history, installation identity and import assignments', async () => {
    await createAttemptRepository(db).saveAttempt(attempt);
    const sync = createTrainingSyncRepository(db, account);
    const installation = await getTrainingInstallationId(db);
    await sync.importUnclaimed(installation);
    await sync.acknowledge(await sync.getPending());
    await clearTrainingCache(db);
    expect(await getTrainingInstallationId(db)).toBe(installation);
    expect(await createAttemptRepository(db).countAttempts()).toBe(1);
    expect(await createAttemptRepository(db, account).countAttempts()).toBe(0);
    expect(await createTrainingSyncRepository(db, other).importUnclaimed(installation)).toBe(0);
  });

  it('refuses cache clearing while another tab has an active account lesson without attempts', async () => {
    const otherTab = await openTrainingDb(factory);
    try {
      await createSessionRepository(otherTab, other).saveSession(session);
      expect(await createTrainingSyncRepository(db, other).countPending()).toBe(0);
      await expect(clearTrainingCache(db)).rejects.toThrow('Pending training uploads');
      await expect(
        createTrainingSyncRepository(db, account).clearDownloadedCache()
      ).rejects.toThrow('Pending training uploads');
      expect(await createSessionRepository(otherTab, other).getSession('session')).toMatchObject({
        status: 'in-progress'
      });
    } finally {
      closeTrainingDb(otherTab);
    }
  });

  it('refuses both cache clears while original-owner writes exist only in the app persistence manager', async () => {
    const sync = createTrainingSyncRepository(db, account);
    await sync.applyDownloadPage({
      attempts: [attempt],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'before-clear'
    });
    vi.mocked(hasPendingTrainingPersistence).mockReturnValue(true);
    await expect(clearTrainingCache(db)).rejects.toThrow('Pending training uploads');
    await expect(sync.clearDownloadedCache()).rejects.toThrow('Pending training uploads');
    expect(await sync.getCursor()).toBe('before-clear');
    expect(await createAttemptRepository(db, account).countAttempts()).toBe(1);
    vi.mocked(hasPendingTrainingPersistence).mockReturnValue(false);
    await sync.clearDownloadedCache();
    expect(await sync.getCursor()).toBeNull();
  });

  it('notifies every affected account after cache clearing, including cursor-only caches', async () => {
    await createTrainingSyncRepository(db, account).applyDownloadPage({
      attempts: [attempt],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'first'
    });
    await createTrainingSyncRepository(db, other).applyDownloadPage({
      attempts: [],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'second'
    });
    const changes: { ownerKey: string; local: boolean }[] = [];
    const unsubscribe = subscribeTrainingDataChanges((event) => changes.push(event));
    try {
      await clearTrainingCache(db);
    } finally {
      unsubscribe();
    }
    expect(changes).toEqual(
      expect.arrayContaining([
        { ownerKey: account, local: true },
        { ownerKey: other, local: true }
      ])
    );
    expect(changes).toHaveLength(2);
  });

  it('adopts identical downloaded destination IDs without requeueing or replacing cloud provenance', async () => {
    const source = createSessionRepository(db);
    await source.saveSession({ ...session, startedAt: '2026-10-20T08:00:00+08:00' });
    await createAttemptRepository(db).saveAttempt({
      ...attempt,
      createdAt: '2026-10-20T08:01:00+08:00'
    });
    await source.updateSessionProgress('session', 12, 'completed', '2026-10-20T08:03:00+08:00');
    const sync = createTrainingSyncRepository(db, account);
    await sync.applyDownloadPage({
      attempts: [attempt],
      sessions: [
        {
          ...session,
          sourceKind: 'native',
          status: 'completed',
          completedAt: '2026-10-20T00:03:00.000Z',
          completedPromptCount: 1,
          eventIds: ['attempt'],
          accuracy: 1,
          occurredAt: '2026-10-20T00:03:00.000Z',
          occurredAtSource: 'client_end'
        }
      ],
      expectedCursor: null,
      nextCursor: 'cloud'
    });
    const installation = await getTrainingInstallationId(db);
    expect(await sync.importUnclaimed(installation)).toBe(2);
    expect(await sync.importUnclaimed(installation)).toBe(0);
    expect(await sync.countPending()).toBe(0);
    expect(await createSessionRepository(db, account).getSession('session')).toMatchObject({
      occurredAtSource: 'client_end',
      completedPromptCount: 1
    });
    expect(await createTrainingSyncRepository(db, other).importUnclaimed(installation)).toBe(0);
  });

  it('rejects changed source content and rolls back import assignments', async () => {
    await createSessionRepository(db).saveSession(session);
    await createAttemptRepository(db).saveAttempt({ ...attempt, latencyMs: 900 });
    const sync = createTrainingSyncRepository(db, account);
    await sync.applyDownloadPage({
      attempts: [attempt],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'cloud'
    });
    await expect(sync.importUnclaimed(await getTrainingInstallationId(db))).rejects.toThrow(
      'Device history ID conflict'
    );
    expect(await sync.getUnclaimedCount()).toBe(2);
    expect(await sync.countPending()).toBe(0);
    expect(await createSessionRepository(db, account).getSession('session')).toBeNull();
  });

  it('compares imported session manifests with source evidence instead of unioning destination evidence', async () => {
    await createSessionRepository(db).saveSession(session);
    await createAttemptRepository(db).saveAttempt(attempt);
    await createSessionRepository(db).updateSessionProgress(
      'session',
      12,
      'completed',
      '2026-10-20T00:03:00.000Z'
    );
    const sync = createTrainingSyncRepository(db, account);
    await sync.applyDownloadPage({
      attempts: [attempt, { ...attempt, id: 'destination-extra' }],
      sessions: [
        {
          ...session,
          status: 'completed',
          completedAt: '2026-10-20T00:03:00.000Z',
          eventIds: ['attempt', 'destination-extra']
        }
      ],
      expectedCursor: null,
      nextCursor: 'cloud'
    });
    await expect(sync.importUnclaimed(await getTrainingInstallationId(db))).rejects.toThrow(
      'Device history ID conflict'
    );
    expect(await sync.getUnclaimedCount()).toBe(2);
    expect(await sync.countPending()).toBe(0);
  });
  it('upgrades old history as unclaimed and archives ambiguous old queues without uploading them', async () => {
    closeTrainingDb(db);
    factory = new IDBFactory();
    const request = factory.open(TRAINING_DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of Object.values(TRAINING_STORES))
        request.result.createObjectStore(name, {
          keyPath:
            name === 'outbox'
              ? 'eventId'
              : name === 'mastery'
                ? 'character'
                : ['attempts', 'sessions'].includes(name)
                  ? 'id'
                  : 'key'
        });
    };
    const old = await reqToPromise(request);
    await withTransaction(
      old,
      [TRAINING_STORES.attempts, TRAINING_STORES.sessions, TRAINING_STORES.outbox],
      'readwrite',
      async (stores) => {
        await reqToPromise(stores.attempts.add(attempt));
        await reqToPromise(stores.sessions.add(session));
        await reqToPromise(stores.outbox.add({ eventId: 'ambiguous', payload: attempt }));
      }
    );
    old.close();
    db = await openTrainingDb(factory);
    expect(await createAttemptRepository(db).countAttempts()).toBe(1);
    expect(await createSessionRepository(db).getSession('session')).toEqual(session);
    expect(await createTrainingSyncRepository(db, account).countPending()).toBe(0);
    expect(
      await withTransaction(db, TRAINING_STORES.outbox, 'readonly', (stores) =>
        reqToPromise(stores.outbox.count())
      )
    ).toBe(1);
    expect(
      await withTransaction(db, OWNED_STORES.outbox, 'readonly', (stores) =>
        reqToPromise(stores[OWNED_STORES.outbox].count())
      )
    ).toBe(0);
  });
});

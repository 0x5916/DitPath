import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { closeTrainingDb, deleteTrainingDb, openTrainingDb } from './training-db';
import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import {
  isValidTrainingSessionRecord,
  type AttemptEvent,
  type TrainingSessionRecord
} from '../training/v2/types';

describe('Local Data Repositories', () => {
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

  describe('AttemptRepository', () => {
    it('is idempotent when saving an attempt with an existing ID', async () => {
      const repo = createAttemptRepository(db);

      const attempt: AttemptEvent = {
        schemaVersion: 1,
        id: 'att_101',
        sessionId: 'sess_1',
        promptId: 'prm_1',
        promptKind: 'recall',
        targetCharacter: 'T',
        enteredText: 'T',
        isCorrect: true,
        classification: 'automatic',
        latencyMs: 1100,
        replayCount: 0,
        inputMode: 'keyboard',
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        createdAt: '2026-10-04T10:00:00.000Z'
      };

      await repo.saveAttempt(attempt);
      expect(await repo.countAttempts()).toBe(1);

      // Save again with same ID (e.g. updated classification)
      await repo.saveAttempt({ ...attempt, latencyMs: 1150 });
      expect(await repo.countAttempts()).toBe(1);

      const retrieved = await repo.getAttempt('att_101');
      expect(retrieved?.latencyMs).toBe(1150);
    });

    it('queries attempts by session, character, and time range', async () => {
      const repo = createAttemptRepository(db);

      const attempts: AttemptEvent[] = [
        {
          schemaVersion: 1,
          id: 'att_1',
          sessionId: 'sess_A',
          promptId: 'prm_1',
          promptKind: 'recall',
          targetCharacter: 'K',
          enteredText: 'K',
          isCorrect: true,
          classification: 'automatic',
          latencyMs: 1200,
          replayCount: 0,
          inputMode: 'keyboard',
          charWpm: 20,
          effWpm: 12,
          freqHz: 600,
          createdAt: '2026-10-04T10:00:00.000Z'
        },
        {
          schemaVersion: 1,
          id: 'att_2',
          sessionId: 'sess_A',
          promptId: 'prm_2',
          promptKind: 'recall',
          targetCharacter: 'M',
          enteredText: 'T',
          isCorrect: false,
          classification: 'incorrect',
          latencyMs: 2400,
          replayCount: 1,
          inputMode: 'keyboard',
          charWpm: 20,
          effWpm: 12,
          freqHz: 600,
          createdAt: '2026-10-04T10:01:00.000Z'
        },
        {
          schemaVersion: 1,
          id: 'att_3',
          sessionId: 'sess_B',
          promptId: 'prm_3',
          promptKind: 'recall',
          targetCharacter: 'K',
          enteredText: 'K',
          isCorrect: true,
          classification: 'developing',
          latencyMs: 1800,
          replayCount: 0,
          inputMode: 'grid',
          charWpm: 20,
          effWpm: 12,
          freqHz: 600,
          createdAt: '2026-10-04T11:00:00.000Z'
        }
      ];

      await repo.saveAttempts(attempts);

      // By session
      const sessAAttempts = await repo.getAttemptsBySession('sess_A');
      expect(sessAAttempts.length).toBe(2);
      expect(sessAAttempts.map((a) => a.id)).toEqual(['att_1', 'att_2']);

      // By character
      const kAttempts = await repo.getAttemptsByCharacter('K');
      expect(kAttempts.length).toBe(2);
      expect(kAttempts.map((a) => a.id)).toEqual(['att_1', 'att_3']);

      // By time range
      const midAttempts = await repo.getAttemptsByTimeRange(
        '2026-10-04T10:00:30.000Z',
        '2026-10-04T10:30:00.000Z'
      );
      expect(midAttempts.length).toBe(1);
      expect(midAttempts[0].id).toBe('att_2');
    });
  });

  describe('SessionRepository', () => {
    it('round-trips practice history without hiding an unfinished guided lesson', async () => {
      const repo = createSessionRepository(db);
      const guided: TrainingSessionRecord = {
        schemaVersion: 1,
        id: 'guided',
        step: 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-16T10:00:00.000Z',
        status: 'in-progress',
        promptCount: 12,
        completedPromptCount: 3
      };
      const practice: TrainingSessionRecord = {
        ...guided,
        id: 'practice',
        mode: 'practice',
        accuracy: 0,
        startedAt: '2026-10-16T11:00:00.000Z',
        completedAt: '2026-10-16T11:01:30.000Z',
        status: 'completed',
        promptCount: 1,
        completedPromptCount: 1
      };
      expect(isValidTrainingSessionRecord(guided)).toBe(true);
      expect(isValidTrainingSessionRecord(practice)).toBe(true);
      for (const fields of [
        { mode: 'unknown' },
        { accuracy: -0.1 },
        { accuracy: 1.1 },
        { accuracy: NaN }
      ])
        expect(isValidTrainingSessionRecord({ ...practice, ...fields })).toBe(false);
      await repo.saveSession(guided);
      await repo.saveSession(practice);
      await repo.saveSession(practice);
      expect(await repo.getSession('practice')).toEqual(practice);
      expect(await repo.getSessions()).toHaveLength(2);
      expect((await repo.getLatestInProgressSession())?.id).toBe('guided');
      await repo.updateSessionProgress('guided', 12, 'completed');
      expect(await repo.getLatestInProgressSession()).toBeNull();
    });

    it('applies the history limit after filtering completed guided and practice sessions', async () => {
      const repo = createSessionRepository(db);
      const completed: TrainingSessionRecord = {
        schemaVersion: 1,
        id: 'guided',
        step: 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-15T10:00:00.000Z',
        status: 'completed',
        promptCount: 1,
        completedPromptCount: 1
      };
      await repo.saveSession(completed);
      await repo.saveSession({ ...completed, id: 'practice', mode: 'practice' });
      for (let index = 0; index < 25; index++) {
        await repo.saveSession({
          ...completed,
          id: `unfinished-${index}`,
          startedAt: '2026-10-16T10:00:00.000Z',
          status: index % 2 ? 'in-progress' : 'abandoned'
        });
      }
      const history = await repo.getSessions(20, 'completed');
      expect(history.map((record) => record.id).sort()).toEqual(['guided', 'practice']);
      expect(await repo.getSessions(1, 'completed')).toHaveLength(1);
      expect(await repo.getSessions(20)).toHaveLength(20);
    });

    it('queries the complete indexed session time range without a fixed recent-session cap', async () => {
      const repo = createSessionRepository(db);
      const base: TrainingSessionRecord = {
        schemaVersion: 1,
        id: 'boundary',
        step: 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-09T12:00:00.000Z',
        status: 'completed',
        promptCount: 12,
        completedPromptCount: 12
      };
      await repo.saveSession(base);
      for (let index = 0; index < 65; index++) {
        await repo.saveSession({
          ...base,
          id: `recent-${index}`,
          startedAt: '2026-10-16T12:00:00.000Z'
        });
      }
      await repo.saveSession({ ...base, id: 'old', startedAt: '2026-10-09T11:59:59.999Z' });
      await repo.saveSession({ ...base, id: 'future', startedAt: '2026-10-16T12:00:00.001Z' });

      const sessions = await repo.getSessionsByTimeRange(
        '2026-10-09T12:00:00.000Z',
        '2026-10-16T12:00:00.000Z'
      );
      expect(sessions).toHaveLength(66);
      expect(sessions[0].id).toBe('boundary');
      expect(sessions.some((session) => ['old', 'future'].includes(session.id))).toBe(false);
    });

    it('does not resurrect an older unfinished session after a newer session finishes or is dismissed', async () => {
      const repo = createSessionRepository(db);
      const session: TrainingSessionRecord = {
        schemaVersion: 1,
        id: 'older',
        step: 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-04T09:00:00.000Z',
        status: 'in-progress',
        promptCount: 15,
        completedPromptCount: 4
      };
      await repo.saveSession(session);
      await repo.saveSession({ ...session, id: 'newer', startedAt: '2026-10-04T10:00:00.000Z' });
      expect((await repo.getLatestInProgressSession())?.id).toBe('newer');
      await repo.updateSessionProgress('newer', 13, 'completed');
      expect(await repo.getLatestInProgressSession()).toBeNull();
      await repo.saveSession({ ...session, id: 'restart', startedAt: '2026-10-04T11:00:00.000Z' });
      await repo.updateSessionProgress('restart', 4, 'abandoned');
      expect(await repo.getLatestInProgressSession()).toBeNull();
      expect((await repo.getSession('older'))?.status).toBe('in-progress');
    });

    it('saves and retrieves sessions and allows loading interrupted in-progress sessions', async () => {
      const repo = createSessionRepository(db);

      const sess1: TrainingSessionRecord = {
        schemaVersion: 1,
        id: 'sess_old',
        step: 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-04T08:00:00.000Z',
        completedAt: '2026-10-04T08:04:00.000Z',
        status: 'completed',
        promptCount: 12,
        completedPromptCount: 12
      };

      const sess2: TrainingSessionRecord = {
        schemaVersion: 1,
        id: 'sess_active',
        step: 2,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: '2026-10-04T09:00:00.000Z',
        status: 'in-progress',
        promptCount: 12,
        completedPromptCount: 5
      };

      await repo.saveSession(sess1);
      await repo.saveSession(sess2);

      const inProgress = await repo.getLatestInProgressSession();
      expect(inProgress).not.toBeNull();
      expect(inProgress?.id).toBe('sess_active');
      expect(inProgress?.completedPromptCount).toBe(5);

      // Update progress
      await repo.updateSessionProgress('sess_active', 12, 'completed', '2026-10-04T09:05:00.000Z');
      const updated = await repo.getSession('sess_active');
      expect(updated?.status).toBe('completed');
      expect(updated?.completedPromptCount).toBe(12);

      // Now no in-progress session exists
      expect(await repo.getLatestInProgressSession()).toBeNull();
    });
  });
});

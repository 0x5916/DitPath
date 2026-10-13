import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { closeTrainingDb, deleteTrainingDb, openTrainingDb } from './training-db';
import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import { createOutboxRepository } from './outbox-repository';
import type { AttemptEvent, TrainingSessionRecord } from '../training/v2/types';

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

  describe('OutboxRepository', () => {
    it('enqueues events and removes only acknowledged IDs', async () => {
      const repo = createOutboxRepository(db);

      const eventA: AttemptEvent = {
        schemaVersion: 1,
        id: 'evt_A',
        sessionId: 'sess_1',
        promptId: 'prm_1',
        promptKind: 'recall',
        targetCharacter: 'T',
        enteredText: 'T',
        isCorrect: true,
        classification: 'automatic',
        latencyMs: 1200,
        replayCount: 0,
        inputMode: 'keyboard',
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        createdAt: '2026-10-04T10:00:00.000Z'
      };

      const eventB: AttemptEvent = {
        ...eventA,
        id: 'evt_B',
        createdAt: '2026-10-04T10:01:00.000Z'
      };

      await repo.enqueue(eventA);
      await repo.enqueue(eventB);
      expect(await repo.countPending()).toBe(2);

      // Acknowledge only eventA
      await repo.acknowledge(['evt_A']);
      expect(await repo.countPending()).toBe(1);

      const pending = await repo.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].eventId).toBe('evt_B');

      // Acknowledging non-existent or empty IDs does not fail
      await repo.acknowledge(['non_existent', '']);
      expect(await repo.countPending()).toBe(1);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { AttemptEvent, TrainingSessionRecord } from '../training/v2/types';
import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import { closeTrainingDb, openTrainingDb } from './training-db';
import { loadHomeDashboard } from './home-dashboard';

const now = '2026-10-22T12:00:00.000Z';
const account = 'account:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
const attempt: AttemptEvent = {
  schemaVersion: 1,
  id: 'attempt',
  sessionId: session.id,
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

describe('Home dashboard data', () => {
  let db: IDBDatabase;
  beforeEach(async () => {
    db = await openTrainingDb(new IDBFactory());
  });
  afterEach(() => closeTrainingDb(db));

  it('excludes empty starts and recognizes completed prompts without scored attempts', async () => {
    expect((await loadHomeDashboard(db, 'unclaimed', now)).hasActivity).toBe(false);
    const repository = createSessionRepository(db);
    await repository.saveSession(session);
    const empty = await loadHomeDashboard(db, 'unclaimed', now);
    expect(empty.hasActivity).toBe(false);
    expect(empty.unfinishedSession?.id).toBe(session.id);
    await repository.updateSessionProgress(session.id, 1);
    expect((await loadHomeDashboard(db, 'unclaimed', now)).hasActivity).toBe(true);
  });

  it('retains lifetime eligibility while old attempts leave the rolling metrics', async () => {
    await createAttemptRepository(db).saveAttempt({
      ...attempt,
      createdAt: '2026-01-01T00:00:00Z'
    });
    const result = await loadHomeDashboard(db, 'unclaimed', now);
    expect(result.hasActivity).toBe(true);
    expect(result.summary.hasRecentActivity).toBe(false);
    expect(result.guidance.masteryMap.get('K')?.totalAttempts).toBe(0);
  });

  it('loads recent guided evidence into both guidance and activity', async () => {
    await createAttemptRepository(db).saveAttempt(attempt);
    const result = await loadHomeDashboard(db, 'unclaimed', now);
    expect(result.guidance.masteryMap.get('K')?.totalAttempts).toBe(1);
    expect(result.summary.accuracyPercent).toBe(100);
  });

  it('recognizes practice-only activity and isolates it from guests and other accounts', async () => {
    await createSessionRepository(db, account).saveSession({
      ...session,
      mode: 'practice',
      status: 'completed',
      completedAt: '2026-10-20T00:03:00.000Z',
      completedPromptCount: 1
    });
    const result = await loadHomeDashboard(db, account, now);
    expect(result.hasActivity).toBe(true);
    expect(result.summary.practiceSessionCount).toBe(1);
    expect(result.guidance.masteryMap.get('K')?.totalAttempts).toBe(0);
    expect(result.summary.accuracyPercent).toBeNull();
    for (const owner of ['unclaimed', 'account:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) {
      const other = await loadHomeDashboard(db, owner, now);
      expect(other.hasActivity).toBe(false);
      expect(other.summary.sessionCount).toBe(0);
    }
  });

  it('exposes unfinished guided recovery only for its owner until it is abandoned', async () => {
    const repository = createSessionRepository(db, account);
    await repository.saveSession({ ...session, completedPromptCount: 1 });
    expect((await loadHomeDashboard(db, account, now)).unfinishedSession?.id).toBe(session.id);
    expect((await loadHomeDashboard(db, 'unclaimed', now)).unfinishedSession).toBeNull();
    await repository.updateSessionProgress(session.id, 1, 'abandoned');
    expect((await loadHomeDashboard(db, account, now)).unfinishedSession).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { buildReviewPlan, type ReviewPlan } from '../training/targeted-review';
import type { AttemptEvent, TrainingSessionRecord } from '../training/v2/types';
import {
  createLearningPilotRepositories,
  getLearningPilotHistory,
  openLearningPilotDb
} from './learning-pilot';
import { openTrainingDb, reqToPromise } from './training-db';
import { createTrainingSyncRepository } from './training-sync-repository';
import { createSessionRepository } from './session-repository';

const owner = 'account:owner-a';
const start = '2026-10-27T01:00:00.000Z';
const end = '2026-10-27T01:05:00.000Z';
const settings = { charWpm: 20, effWpm: 12, freqHz: 600 };
function record(plan: ReviewPlan): TrainingSessionRecord {
  return {
    schemaVersion: 1,
    id: 'review',
    step: 3,
    ...settings,
    startedAt: start,
    status: 'in-progress',
    promptCount: plan.prompts.length,
    completedPromptCount: 0
  };
}
function answer(plan: ReviewPlan, index = 0): AttemptEvent {
  const prompt = plan.prompts[index];
  return {
    schemaVersion: 1,
    id: `answer-${index}`,
    sessionId: 'review',
    promptId: prompt.id,
    promptKind: prompt.spec.kind,
    targetCharacter: prompt.spec.expectedText,
    enteredText: prompt.spec.expectedText,
    isCorrect: true,
    classification: 'unmeasured',
    latencyMs: 4000,
    replayCount: 0,
    inputMode: 'keyboard',
    ...settings,
    createdAt: '2026-10-27T01:01:00.000Z'
  };
}

describe('local learning pilot storage', () => {
  let db: IDBDatabase;
  let factory: IDBFactory;
  let plan: ReviewPlan;
  beforeEach(async () => {
    factory = new IDBFactory();
    db = await openLearningPilotDb(factory);
    let id = 0;
    plan = buildReviewPlan(
      { purpose: 'coaching', targets: ['K', 'M'] },
      ['K', 'M', 'R', 'S'],
      settings,
      () => 0.25,
      () => `prompt-${id++}`
    );
  });
  afterEach(() => {
    db.close();
    vi.unstubAllGlobals();
  });

  it('keeps truthful local history isolated from other owners and the old upload database', async () => {
    const repo = createLearningPilotRepositories(db, owner, plan);
    await repo.sessionRepo.saveSession(record(plan));
    await repo.attemptRepo.saveAttempt(answer(plan));
    const [history] = await getLearningPilotHistory(db, owner);
    expect(history).toMatchObject({
      purpose: 'coaching',
      targets: ['K', 'M'],
      localOnly: true,
      completedPromptCount: 1,
      counts: { firstListen: 1, answered: 1 }
    });
    expect(await getLearningPilotHistory(db, 'account:owner-b')).toEqual([]);
    expect(await getLearningPilotHistory(db, 'unclaimed')).toEqual([]);
    const stored = await reqToPromise(
      db.transaction('sessions').objectStore('sessions').get([owner, 'review'])
    );
    expect(stored.mode).toBeUndefined();
    expect(stored.plan.purpose).toBe('coaching');
    const old = await openTrainingDb(factory);
    try {
      expect(await createSessionRepository(old, owner).getSessions()).toEqual([]);
      expect(await createTrainingSyncRepository(old, owner).countPending()).toBe(0);
    } finally {
      old.close();
    }
  });

  it('freezes first responses and rejects another ID for the same prompt', async () => {
    const repo = createLearningPilotRepositories(db, owner, plan);
    await repo.sessionRepo.saveSession(record(plan));
    const attempt = answer(plan);
    await repo.attemptRepo.saveAttempt(attempt);
    await repo.attemptRepo.saveAttempt(attempt);
    await expect(repo.attemptRepo.saveAttempt({ ...attempt, replayCount: 1 })).rejects.toThrow(
      'Immutable'
    );
    await expect(repo.attemptRepo.saveAttempt({ ...attempt, id: 'different-id' })).rejects.toThrow(
      'first response'
    );
    expect(await repo.attemptRepo.countAttempts()).toBe(1);
    expect((await repo.sessionRepo.getSession('review'))?.completedPromptCount).toBe(1);
  });

  it('rolls back the whole batch and count when one observation is invalid', async () => {
    const repo = createLearningPilotRepositories(db, owner, plan);
    await repo.sessionRepo.saveSession(record(plan));
    await expect(
      repo.attemptRepo.saveAttempts([
        answer(plan),
        { ...answer(plan, 1), classification: 'automatic' }
      ])
    ).rejects.toThrow('Invalid');
    expect(await repo.attemptRepo.countAttempts()).toBe(0);
    expect((await repo.sessionRepo.getSession('review'))?.completedPromptCount).toBe(0);
  });

  it('requires a real saved plan and matching sound/target context', async () => {
    const repo = createLearningPilotRepositories(db, owner, plan);
    await expect(repo.attemptRepo.saveAttempt(answer(plan))).rejects.toThrow('Unknown');
    await repo.sessionRepo.saveSession(record(plan));
    await expect(repo.attemptRepo.saveAttempt({ ...answer(plan), charWpm: 25 })).rejects.toThrow(
      'Invalid'
    );
    await expect(
      repo.attemptRepo.saveAttempt({ ...answer(plan), targetCharacter: 'Z' })
    ).rejects.toThrow('Invalid');
    expect(await repo.attemptRepo.countAttempts()).toBe(0);
  });

  it('only finalizes complete response sets and keeps terminal history immutable', async () => {
    const repo = createLearningPilotRepositories(db, owner, plan);
    await repo.sessionRepo.saveSession(record(plan));
    await expect(
      repo.sessionRepo.updateSessionProgress('review', 12, 'completed', end)
    ).rejects.toThrow('every planned');
    await repo.attemptRepo.saveAttempts(plan.prompts.map((_, i) => answer(plan, i)));
    await repo.sessionRepo.updateSessionProgress('review', 12, 'completed', end);
    await repo.sessionRepo.updateSessionProgress('review', 12, 'completed', end);
    await repo.attemptRepo.saveAttempt(answer(plan));
    await expect(repo.attemptRepo.saveAttempt({ ...answer(plan), id: 'late' })).rejects.toThrow(
      'finalized'
    );
    await expect(
      repo.sessionRepo.updateSessionProgress('review', 12, 'abandoned', end)
    ).rejects.toThrow('terminal');
    expect((await getLearningPilotHistory(db, owner))[0]).toMatchObject({
      status: 'completed',
      completedAt: end,
      completedPromptCount: 12
    });
  });

  it('preserves partial abandoned records without inventing an ending or completed count', async () => {
    const repo = createLearningPilotRepositories(db, owner, plan);
    await repo.sessionRepo.saveSession(record(plan));
    await repo.attemptRepo.saveAttempt(answer(plan));
    await repo.sessionRepo.updateSessionProgress('review', 999, 'abandoned');
    db.close();
    db = await openLearningPilotDb(factory);
    expect((await getLearningPilotHistory(db, owner))[0]).toMatchObject({
      status: 'abandoned',
      completedPromptCount: 1
    });
    expect((await getLearningPilotHistory(db, owner))[0].completedAt).toBeUndefined();
  });

  it('captures a plan copy and rejects a changed plan for an existing session', async () => {
    const original = structuredClone(plan);
    const repo = createLearningPilotRepositories(db, owner, plan);
    plan.targets.reverse();
    await repo.sessionRepo.saveSession(record(original));
    await repo.attemptRepo.saveAttempt(answer(original));
    expect((await getLearningPilotHistory(db, owner))[0].targets).toEqual(original.targets);
    const changed = createLearningPilotRepositories(db, owner, plan);
    await expect(changed.sessionRepo.saveSession(record(plan))).rejects.toThrow('plan conflict');
  });

  it('keeps correct after replay separate and returns the real screening purpose', async () => {
    let n = 0;
    const screening = buildReviewPlan(
      { purpose: 'return-screening', targets: [] },
      ['K', 'M'],
      settings,
      () => 0.25,
      () => `screen-${n++}`
    );
    const repo = createLearningPilotRepositories(db, owner, screening);
    await repo.sessionRepo.saveSession(record(screening));
    await repo.attemptRepo.saveAttempt({ ...answer(screening), replayCount: 2 });
    expect((await getLearningPilotHistory(db, owner))[0]).toMatchObject({
      purpose: 'return-screening',
      counts: { answered: 1, firstListen: 0, afterReplay: 1, notCorrect: 0 }
    });
  });

  it('rejects unsupported scored plans and browserless opening', async () => {
    expect(() =>
      createLearningPilotRepositories(db, owner, {
        ...plan,
        prompts: plan.prompts.map((p) => ({ ...p, isScored: true }))
      })
    ).toThrow('unscored');
    vi.stubGlobal('window', undefined);
    await expect(openLearningPilotDb()).rejects.toThrow('unavailable');
  });
});

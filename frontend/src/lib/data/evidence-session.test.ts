import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createLearningEvidenceRepository, openLearningEvidenceDb } from './learning-evidence';
import { createEvidenceSessionRepositories } from './evidence-session';
import { createEvidenceAudioEngine } from '../audio/evidence-engine';
import type { AudioEngine, AudioEngineEvent } from '../audio/engine';
import { GuidedSessionController } from '../training/v2/session-controller.svelte';
import { buildReviewPlan } from '../training/targeted-review';
import { buildMixedCheck } from '../training/learning-policy/mixed-plan';
import { activeLearningProfile, projectLearningSnapshot } from './learning-snapshot';
const databases: IDBDatabase[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
async function fixture() {
  const db = await openLearningEvidenceDb(new IDBFactory());
  databases.push(db);
  const owner = 'account:a',
    repo = createLearningEvidenceRepository(db, owner);
  let now = Date.parse('2026-10-20T00:00:00Z'),
    active = false;
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const base: AudioEngine = {
    play: () => {
      active = true;
    },
    stop: async () => {
      active = false;
    },
    pause: async () => {},
    resume: async () => {},
    dispose: async () => {},
    isActive: () => active,
    isPaused: () => false,
    elapsed: () => 0,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
  const profile = activeLearningProfile(20);
  const built = buildMixedCheck({
    ownerKey: owner,
    targets: ['K', 'M'],
    knownCharacters: ['K', 'M'],
    profile,
    effWpm: 12,
    freqHz: 600,
    startedAt: new Date(now).toISOString(),
    checkId: 'mixed'
  });
  const audio = createEvidenceAudioEngine({
    source: 'mixed-check',
    sessionId: 'mixed',
    ownerKey: owner,
    currentOwner: () => owner,
    repository: repo,
    base,
    clock: () => ({
      earliest: new Date(now).toISOString(),
      latest: new Date(now).toISOString(),
      source: 'monotonic-anchored'
    })
  });
  const ports = createEvidenceSessionRepositories(
    repo,
    owner,
    {
      purpose: 'mixed-check',
      targets: ['K', 'M'],
      knownCharacters: ['K', 'M'],
      prompts: built.prompts,
      profile
    },
    audio
  );
  const controller = new GuidedSessionController({
    sessionId: 'mixed',
    step: 1,
    prompts: built.prompts,
    audioEngine: audio,
    attemptRepo: ports.attemptRepo,
    sessionRepo: ports.sessionRepo,
    onPromptPlayback: ports.captureFirst,
    allowProgression: false,
    feedback: 'after-check',
    clock: () => now,
    nowIso: () => new Date(now).toISOString()
  });
  const finish = async () => {
    now += 1000;
    active = false;
    for (const fn of listeners) fn('ended');
    await audio.flush();
  };
  return {
    db,
    repo,
    controller,
    audio,
    finish,
    advance: () => {
      now += 1000;
    },
    profile
  };
}
describe('prospective session capture through controller ports', () => {
  it('persists a frozen plan, first attempts and exact terminal manifest without legacy events', async () => {
    const f = await fixture();
    await f.controller.start();
    for (let i = 0; i < 20; i++) {
      const prompt = f.controller.currentPrompt!;
      f.controller.play();
      await f.audio.flush();
      await f.finish();
      expect(f.controller.submitAnswer(prompt.spec.expectedText, 'keyboard')).toBe(true);
      f.advance();
    }
    expect(await f.controller.flushPersistence()).toBe(true);
    const records = await f.repo.all(),
      observations = records.filter((r) => r.kind === 'observation');
    expect(records).toHaveLength(62);
    expect(observations).toHaveLength(20);
    expect(records.find((r) => r.kind === 'terminal')).toMatchObject({
      status: 'completed',
      observation_ids: observations.map((o) => o.id).sort()
    });
    expect((await f.repo.pending()).length).toBe(62);
    expect(await createLearningEvidenceRepository(f.db, 'account:b').all()).toEqual([]);
    expect(
      projectLearningSnapshot(records, {
        ownerKey: 'account:a',
        profile: f.profile,
        coverage: 'local-only',
        nowIso: '2026-10-21T00:00:00Z'
      }).checks[0].whole
    ).toMatchObject({ eligible: 20, unassistedCorrect: 20 });
    await f.controller.dispose();
  });
  it('retains an interrupted first presentation and freezes observations across save retries', async () => {
    const f = await fixture();
    await f.controller.start();
    f.controller.play();
    // Interrupt before asynchronous guard preparation settles.
    f.controller.pause();
    f.controller.resume();
    await f.audio.flush();
    f.controller.play();
    await f.audio.flush();
    await f.finish();
    const append = vi
      .spyOn(f.repo, 'append')
      .mockRejectedValueOnce(new Error('Synthetic disk failure'));
    f.controller.submitAnswer(f.controller.currentPrompt!.spec.expectedText, 'keyboard');
    expect(await f.controller.flushPersistence()).toBe(false);
    const firstWrite = structuredClone(append.mock.calls[0][0]);
    expect(await f.controller.retryPersistence()).toBe(true);
    expect(append.mock.calls[1][0]).toEqual(firstWrite);
    const before = (await f.repo.all()).find((r) => r.kind === 'observation')!;
    expect(before).toMatchObject({ audio_valid: false, interruption_invalidated: true });
    expect(
      (await f.repo.all()).some(
        (r) => r.kind === 'exposure-open' && r.presentation_id === before.presentation_id
      )
    ).toBe(true);
    await f.controller.retryPersistence();
    expect((await f.repo.all()).filter((r) => r.kind === 'observation')).toEqual([before]);
    append.mockRestore();
    await f.controller.dispose();
  });
});

it.each(['coaching', 'screening'] as const)(
  'captures %s plans with API-compatible purpose and prompt roles',
  async (purpose) => {
    const f = await fixture(),
      owner = 'account:a';
    const plan = buildReviewPlan(
      {
        purpose: purpose === 'screening' ? 'return-screening' : 'coaching',
        targets: purpose === 'screening' ? [] : ['K', 'M']
      },
      ['K', 'M'],
      { charWpm: 20, effWpm: 12, freqHz: 600 }
    );
    const ports = createEvidenceSessionRepositories(
      f.repo,
      owner,
      {
        purpose,
        targets: plan.targets,
        knownCharacters: plan.knownCharacters,
        prompts: plan.prompts,
        profile: f.profile
      },
      f.audio
    );
    await ports.sessionRepo.saveSession({
      schemaVersion: 1,
      id: 'review_contract',
      mode: 'guided',
      step: 1,
      status: 'in-progress',
      startedAt: '2026-10-27T00:00:00Z',
      promptCount: plan.prompts.length,
      completedPromptCount: 0,
      charWpm: 20,
      effWpm: 12,
      freqHz: 600
    });
    const record = (await f.repo.all()).find((r) => r.kind === 'plan')!;
    expect(record).toMatchObject({
      purpose,
      feedback: 'immediate',
      targets: expect.arrayContaining(['K', 'M'])
    });
    expect((record.prompts as { role: string }[]).every((p) => p.role === 'target')).toBe(true);
    expect(record.review_cycle_ids).toBeUndefined();
    await f.controller.dispose();
  }
);

import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from './learning-evidence';
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

const startedAt = '2026-10-20T00:00:00.000Z';
const endedAt = '2026-10-20T00:10:00.000Z';
const bounds = (time: string) => ({ earliest: time, latest: time, source: 'wall-clock-bounded' });
async function finalizeFixture(breakEvidence: (records: EvidenceRecord[]) => void) {
  const db = await openLearningEvidenceDb(new IDBFactory());
  databases.push(db);
  const owner = 'account:a',
    repo = createLearningEvidenceRepository(db, owner),
    profile = activeLearningProfile(20);
  const built = buildMixedCheck({
    ownerKey: owner,
    targets: ['K', 'M'],
    knownCharacters: ['K', 'M'],
    profile,
    effWpm: 12,
    freqHz: 600,
    startedAt,
    checkId: 'mixed'
  });
  const audio = {
    flush: async () => {},
    presentation: () => null
  } as unknown as import('../audio/evidence-engine').EvidenceAudioEngine;
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
  await ports.sessionRepo.saveSession({
    schemaVersion: 1,
    id: 'mixed',
    mode: 'guided',
    step: 1,
    status: 'in-progress',
    startedAt,
    promptCount: built.prompts.length,
    completedPromptCount: 0,
    charWpm: 20,
    effWpm: 12,
    freqHz: 600
  });
  const records: EvidenceRecord[] = [];
  for (const [index, prompt] of built.prompts.entries()) {
    const presentation = `tone_${index}`,
      open = `open_${presentation}`,
      at = new Date(Date.parse(startedAt) + (index + 1) * 1000).toISOString(),
      character = prompt.spec.expectedText;
    records.push({
      id: open,
      kind: 'exposure-open',
      policy_version: 'learning-policy-1.0',
      recorded_at: startedAt,
      session_id: 'mixed',
      presentation_id: presentation,
      characters: [character],
      source: 'mixed-check',
      started_at: bounds(at)
    });
    records.push({
      id: `close_${presentation}`,
      kind: 'exposure-close',
      policy_version: 'learning-policy-1.0',
      recorded_at: at,
      open_id: open,
      end_reason: 'completed',
      last_exposure: { [character]: bounds(at) }
    });
    records.push({
      id: `answer_${index}`,
      kind: 'observation',
      policy_version: 'learning-policy-1.0',
      recorded_at: at,
      session_id: 'mixed',
      prompt_id: prompt.id,
      presentation_id: presentation,
      first_response: character,
      final_response: character,
      skipped: false,
      replay_count_before_response: 0,
      help_before_response: false,
      audio_valid: true,
      interruption_invalidated: false,
      response_interface: 'keyboard',
      first_presented_at: bounds(at),
      prior_exposure: null
    });
  }
  breakEvidence(records);
  await repo.append(records);
  await ports.sessionRepo.updateSessionProgress(
    'mixed',
    built.prompts.length,
    'completed',
    endedAt
  );
  return { repo, records };
}
it.each([
  ['valid completion', () => {}, 'completed'],
  [
    'missing closure',
    (records: EvidenceRecord[]) => {
      records.splice(
        records.findIndex((r) => r.kind === 'exposure-close'),
        1
      );
    },
    'incomplete'
  ],
  [
    'stopped playback',
    (records: EvidenceRecord[]) => {
      records.find((r) => r.kind === 'exposure-close')!.end_reason = 'stopped';
    },
    'incomplete'
  ],
  [
    'invalid audio',
    (records: EvidenceRecord[]) => {
      records.find((r) => r.kind === 'observation')!.audio_valid = false;
    },
    'incomplete'
  ],
  [
    'unresolved guard bounds',
    (records: EvidenceRecord[]) => {
      records.find((r) => r.kind === 'exposure-open')!.started_at = null;
      records.find((r) => r.kind === 'exposure-close')!.last_exposure = {};
    },
    'incomplete'
  ],
  [
    'missing guard',
    (records: EvidenceRecord[]) => {
      records.splice(
        records.findIndex((r) => r.kind === 'exposure-open'),
        1
      );
    },
    'incomplete'
  ]
])(
  'derives terminal status from evaluated delivery evidence: %s',
  async (_, breakEvidence, status) => {
    const f = await finalizeFixture(breakEvidence);
    const records = await f.repo.all();
    expect(records.find((r) => r.kind === 'terminal')).toMatchObject({
      status,
      observation_ids: records
        .filter((r) => r.kind === 'observation')
        .map((r) => r.id)
        .sort()
    });
    expect(
      projectLearningSnapshot(records, {
        ownerKey: 'account:a',
        profile: activeLearningProfile(20),
        coverage: 'local-only',
        nowIso: '2026-10-21T00:00:00Z'
      }).checks[0].complete
    ).toBe(status === 'completed');
  }
);
it.each(['coaching', 'screening'] as const)(
  'captures %s plans with API-compatible purpose and prompt roles',
  async (purpose) => {
    const f = await fixture(),
      owner = 'account:a';
    const plan = buildReviewPlan(
      {
        purpose: purpose === 'screening' ? 'return-screening' : 'coaching',
        targets: purpose === 'screening' ? ['K'] : ['K', 'M']
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
      targets: purpose === 'screening' ? ['K'] : expect.arrayContaining(['K', 'M'])
    });
    expect((record.prompts as { role: string }[]).every((p) => p.role === 'target')).toBe(true);
    expect(record.review_cycle_ids).toBeUndefined();
    await f.controller.dispose();
  }
);

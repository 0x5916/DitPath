import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, AudioEngineEvent } from '../../audio/engine';
import type { AudioPlan } from '../timing';
import type { AttemptRepository } from '../../data/attempt-repository';
import type { SessionRepository } from '../../data/session-repository';
import { GuidedSessionController } from './session-controller.svelte';
import type { AttemptEvent, Prompt, TrainingSessionRecord } from './types';

function createFakeAudioEngine(): AudioEngine & {
  listeners: Set<(e: AudioEngineEvent) => void>;
  playedPlans: AudioPlan[];
  finish: () => void;
} {
  const listeners = new Set<(e: AudioEngineEvent) => void>();
  const playedPlans: AudioPlan[] = [];
  let active = false;
  let paused = false;

  return {
    listeners,
    playedPlans,
    finish: () => {
      active = false;
      for (const listener of listeners) listener('ended');
    },
    play: vi.fn((plan: AudioPlan) => {
      playedPlans.push(plan);
      active = true;
      paused = false;
    }),
    pause: vi.fn(async () => {
      paused = true;
    }),
    resume: vi.fn(async () => {
      paused = false;
    }),
    stop: vi.fn(async () => {
      active = false;
      paused = false;
    }),
    dispose: vi.fn(async () => {
      active = false;
      paused = false;
    }),
    subscribe: vi.fn((listener: (e: AudioEngineEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    isActive: () => active,
    isPaused: () => paused,
    elapsed: () => 0
  };
}

function createFakeAttemptRepo(): AttemptRepository & { saved: AttemptEvent[] } {
  const saved: AttemptEvent[] = [];
  return {
    saved,
    saveAttempt: vi.fn(async (a: AttemptEvent) => {
      const index = saved.findIndex((attempt) => attempt.id === a.id);
      if (index < 0) saved.push(a);
      else saved[index] = a;
    }),
    saveAttempts: vi.fn(async (as: AttemptEvent[]) => {
      saved.push(...as);
    }),
    getAttempt: vi.fn(async (id: string) => saved.find((a) => a.id === id) ?? null),
    getAttemptsBySession: vi.fn(async (sid: string) => saved.filter((a) => a.sessionId === sid)),
    getAttemptsByCharacter: vi.fn(async (c: string) =>
      saved.filter((a) => a.targetCharacter === c)
    ),
    getAttemptsByTimeRange: vi.fn(async () => []),
    countAttempts: vi.fn(async () => saved.length)
  };
}

function createFakeSessionRepo(): SessionRepository & {
  sessions: TrainingSessionRecord[];
  updates: { id: string; count: number; status?: string; at?: string }[];
} {
  const sessions: TrainingSessionRecord[] = [];
  const updates: { id: string; count: number; status?: string; at?: string }[] = [];

  return {
    sessions,
    updates,
    saveSession: vi.fn(async (s: TrainingSessionRecord) => {
      const index = sessions.findIndex((session) => session.id === s.id);
      if (index < 0) sessions.push({ ...s });
      else sessions[index] = { ...s };
    }),
    getSession: vi.fn(async (id: string) => sessions.find((s) => s.id === id) ?? null),
    getLatestInProgressSession: vi.fn(async () => null),
    getSessions: vi.fn(async () => sessions),
    getSessionsByTimeRange: vi.fn(async (start: string, end: string) =>
      sessions.filter((session) => session.startedAt >= start && session.startedAt <= end)
    ),
    updateSessionProgress: vi.fn(
      async (...args: Parameters<SessionRepository['updateSessionProgress']>) => {
        const [id, count, status, at] = args;
        updates.push({ id, count, status, at });
        const record = sessions.find((s) => s.id === id);
        if (record) {
          record.completedPromptCount = count;
          if (status) record.status = status as TrainingSessionRecord['status'];
          if (at) record.completedAt = at;
        }
      }
    )
  };
}

function createMockPrompt(id: string, expectedText = 'T'): Prompt {
  return {
    id,
    ordinal: 1,
    isScored: true,
    spec: {
      kind: 'recall',
      expectedText,
      characters: [expectedText],
      charWpm: 20,
      effWpm: 12,
      freqHz: 600
    }
  };
}

describe('Guided Session Controller (Svelte 5 runes)', () => {
  it.each(['keyboard', 'grid'] as const)(
    'keeps correct warm-up answers correct via %s',
    async (mode: 'keyboard' | 'grid') => {
      const prompt = { ...createMockPrompt('warmup', 'K'), isScored: false };
      const audio = createFakeAudioEngine();
      const controller = new GuidedSessionController({
        step: 1,
        prompts: [prompt],
        audioEngine: audio,
        attemptRepo: createFakeAttemptRepo(),
        sessionRepo: createFakeSessionRepo()
      });
      await controller.start();
      controller.play();
      audio.finish();
      expect(controller.submitAnswer('k', mode)).toBe(true);
      expect(controller.lastAttempt?.isCorrect).toBe(true);
      expect(controller.lastAttempt?.classification).toBe('unmeasured');
      expect(controller.submitAnswer('K', mode)).toBe(false);
      expect(controller.attempts).toHaveLength(1);
      controller.dispose();
    }
  );

  it('auditions feedback without rescoring and stops for exit confirmation or continuation', async () => {
    const audio = createFakeAudioEngine();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('first', 'K'), createMockPrompt('next', 'M')],
      audioEngine: audio,
      attemptRepo: createFakeAttemptRepo(),
      sessionRepo: createFakeSessionRepo()
    });
    await controller.start();
    controller.playFeedback('M');
    expect(audio.playedPlans).toHaveLength(0);
    controller.play();
    audio.finish();
    controller.submitAnswer('M', 'keyboard');
    const readyAt = controller.state.answerReadyAtMs;
    controller.playFeedback('K');
    expect(audio.playedPlans.at(-1)?.text).toBe('K');
    audio.finish();
    expect(controller.feedbackCharacter).toBeNull();
    expect(controller.phase).toBe('feedback');
    controller.playFeedback('M');
    expect(audio.playedPlans.at(-1)?.text).toBe('M');
    expect(controller.attempts).toHaveLength(1);
    expect(controller.replayCount).toBe(0);
    expect(controller.state.answerReadyAtMs).toBe(readyAt);
    controller.pause();
    expect(audio.isActive()).toBe(false);
    expect(controller.feedbackCharacter).toBeNull();
    expect(controller.phase).toBe('feedback');
    expect(controller.attempts).toHaveLength(1);
    controller.playFeedback('M');
    controller.continue();
    expect(audio.stop).toHaveBeenCalledWith({ notify: false });
    expect(controller.phase).toBe('ready');
    expect(controller.feedbackCharacter).toBeNull();
    controller.dispose();
  });

  it('surfaces feedback playback failures and allows another audition', async () => {
    const audio = createFakeAudioEngine();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('first', 'K')],
      audioEngine: audio,
      attemptRepo: createFakeAttemptRepo(),
      sessionRepo: createFakeSessionRepo()
    });
    await controller.start();
    controller.play();
    audio.finish();
    controller.submitAnswer('M', 'grid');
    vi.mocked(audio.play).mockImplementationOnce(() => {
      throw new Error('Unavailable');
    });
    controller.playFeedback('K');
    expect(controller.feedbackAudioError).toBe('Unavailable');
    expect(controller.phase).toBe('feedback');
    controller.playFeedback('M');
    expect(controller.feedbackAudioError).toBeNull();
    expect(controller.feedbackCharacter).toBe('M');
    controller.handleVisibilityChange(true);
    expect(audio.isActive()).toBe(false);
    expect(controller.attempts).toHaveLength(1);
    controller.dispose();
  });

  it('initializes and saves session record on start', async () => {
    const currentTime = 1000;
    const fakeAudio = createFakeAudioEngine();
    const fakeAttempts = createFakeAttemptRepo();
    const fakeSessions = createFakeSessionRepo();

    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('prm_1', 'K')],
      clock: () => currentTime,
      nowIso: () => new Date(currentTime).toISOString(),
      audioEngine: fakeAudio,
      attemptRepo: fakeAttempts,
      sessionRepo: fakeSessions
    });

    expect(controller.phase).toBe('idle');

    await controller.start();

    expect(fakeSessions.saveSession).toHaveBeenCalled();
    expect(fakeSessions.sessions.length).toBe(1);
    expect(fakeSessions.sessions[0].step).toBe(1);
    expect(controller.phase).toBe('ready');

    controller.dispose();
  });

  it('coordinates play, audio ended callback, and latency calculation on submit', async () => {
    let currentTime = 1000;
    const fakeAudio = createFakeAudioEngine();
    const fakeAttempts = createFakeAttemptRepo();
    const fakeSessions = createFakeSessionRepo();

    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('prm_1', 'T')],
      clock: () => currentTime,
      nowIso: () => new Date(currentTime).toISOString(),
      audioEngine: fakeAudio,
      attemptRepo: fakeAttempts,
      sessionRepo: fakeSessions
    });

    await controller.start();

    // Trigger Play
    controller.play();
    expect(fakeAudio.play).toHaveBeenCalled();
    expect(controller.phase).toBe('playing');

    // Simulate audio ended at t=2500ms
    currentTime = 2500;
    controller.onAudioEnded();
    expect(controller.phase).toBe('answering');
    expect(controller.state.answerReadyAtMs).toBe(2500);

    // Learner types 'T' and submits at t=3700ms (latency = 1200ms)
    currentTime = 3700;
    const submitted = controller.submitAnswer('T', 'keyboard');
    expect(submitted).toBe(true);
    expect(controller.phase).toBe('feedback');
    expect(controller.lastAttempt?.isCorrect).toBe(true);
    expect(controller.lastAttempt?.latencyMs).toBe(1200);

    // Verify persistence called after async settling
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeAttempts.saveAttempt).toHaveBeenCalled();
    expect(fakeAttempts.saved.length).toBe(1);
    // The attempt repository commits the answer and owning session progress atomically.
    expect(fakeSessions.updateSessionProgress).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('pauses on visibility hidden while playing or answering', async () => {
    const fakeAudio = createFakeAudioEngine();
    const fakeAttempts = createFakeAttemptRepo();
    const fakeSessions = createFakeSessionRepo();

    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('prm_1', 'T')],
      audioEngine: fakeAudio,
      attemptRepo: fakeAttempts,
      sessionRepo: fakeSessions
    });

    await controller.start();
    controller.play();
    expect(controller.phase).toBe('playing');

    // Browser tab backgrounded
    controller.handleVisibilityChange(true);
    expect(controller.phase).toBe('paused');
    expect(fakeAudio.pause).toHaveBeenCalled();

    // Browser tab foregrounded & resumed
    controller.resume();
    expect(controller.phase).toBe('ready'); // Ready to hear again safely without jump

    controller.dispose();
  });

  it('surfaces persistence errors without losing in-memory answer state', async () => {
    const fakeAudio = createFakeAudioEngine();
    const fakeAttempts = createFakeAttemptRepo();
    // Simulate DB transaction error
    fakeAttempts.saveAttempt = vi.fn().mockRejectedValue(new Error('IndexedDB QuotaExceeded'));
    const fakeSessions = createFakeSessionRepo();

    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('prm_1', 'T')],
      audioEngine: fakeAudio,
      attemptRepo: fakeAttempts,
      sessionRepo: fakeSessions
    });

    await controller.start();
    controller.play();
    controller.onAudioEnded();

    controller.submitAnswer('T', 'keyboard');
    expect(controller.phase).toBe('feedback');
    expect(controller.lastAttempt?.isCorrect).toBe(true);

    // In-memory state preserved, persistence error recorded
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.persistenceError).toContain('IndexedDB QuotaExceeded');

    controller.dispose();
  });

  it('marks session completed in session repository on finishing all prompts', async () => {
    const currentTime = 1000;
    const fakeAudio = createFakeAudioEngine();
    const fakeAttempts = createFakeAttemptRepo();
    const fakeSessions = createFakeSessionRepo();

    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('prm_1', 'K')],
      clock: () => currentTime,
      nowIso: () => new Date(currentTime).toISOString(),
      audioEngine: fakeAudio,
      attemptRepo: fakeAttempts,
      sessionRepo: fakeSessions
    });

    await controller.start();
    controller.play();
    controller.onAudioEnded();
    controller.submitAnswer('K', 'keyboard');

    // Continue finishes the 1-prompt session
    controller.continue();
    expect(controller.phase).toBe('complete');
    expect(controller.summary).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const completionUpdate = fakeSessions.updates.find((u) => u.status === 'completed');
    expect(completionUpdate).toBeDefined();

    controller.dispose();
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function answer(controller: GuidedSessionController, text = 'K') {
  controller.play();
  controller.onAudioEnded();
  expect(controller.submitAnswer(text, 'keyboard')).toBe(true);
  controller.continue();
}

describe('guided persistence commit ordering and recovery', () => {
  it('waits for initialization commit and retries the same record with actual prompt settings', async () => {
    const initialCommit = deferred();
    const sessions = createFakeSessionRepo();
    vi.mocked(sessions.saveSession).mockImplementationOnce(() => initialCommit.promise);
    const prompt = createMockPrompt('custom', 'K');
    prompt.spec = { ...prompt.spec, charWpm: 25, effWpm: 15, freqHz: 700 };
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [prompt],
      audioEngine: createFakeAudioEngine(),
      attemptRepo: createFakeAttemptRepo(),
      sessionRepo: sessions
    });
    const starting = controller.start();
    const duplicateStart = controller.start();
    expect(controller.phase).toBe('idle');
    expect(controller.persistenceStatus).toBe('saving');
    expect(sessions.saveSession).toHaveBeenCalledTimes(1);
    initialCommit.reject(new Error('Storage unavailable'));
    await Promise.all([starting, duplicateStart]);
    expect(controller.phase).toBe('idle');
    expect(controller.persistenceStatus).toBe('failed');
    expect(await controller.retryPersistence()).toBe(true);
    expect(controller.phase).toBe('ready');
    expect(controller.persistenceStatus).toBe('saved');
    const records = vi.mocked(sessions.saveSession).mock.calls.map(([record]) => record);
    expect(records[1]).toEqual(records[0]);
    expect(records[1]).toMatchObject({ charWpm: 25, effWpm: 15, freqHz: 700 });
    expect(sessions.sessions).toHaveLength(1);
    await controller.dispose();
  });

  it('keeps completion saving until the final answer commits, including during disposal', async () => {
    const attemptCommit = deferred();
    const attempts = createFakeAttemptRepo();
    const save = vi.mocked(attempts.saveAttempt).getMockImplementation()!;
    vi.mocked(attempts.saveAttempt).mockImplementationOnce(async (attempt) => {
      await attemptCommit.promise;
      await save(attempt);
    });
    const sessions = createFakeSessionRepo();
    const audio = createFakeAudioEngine();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('last', 'K')],
      audioEngine: audio,
      attemptRepo: attempts,
      sessionRepo: sessions
    });
    await controller.start();
    answer(controller);
    expect(controller.phase).toBe('complete');
    expect(controller.persistenceStatus).toBe('saving');
    expect(sessions.updates).toEqual([]);
    let disposed = false;
    const disposing = controller.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(disposed).toBe(false);
    attemptCommit.resolve();
    await disposing;
    expect(attempts.saved).toHaveLength(1);
    expect(sessions.updates.map(({ count, status }) => ({ count, status }))).toEqual([
      { count: 1, status: 'completed' }
    ]);
    expect(controller.persistenceStatus).toBe('saved');
  });

  it('keeps storage cleanup waiting for pending writes even when audio disposal rejects', async () => {
    const commit = deferred();
    const attempts = createFakeAttemptRepo();
    const save = vi.mocked(attempts.saveAttempt).getMockImplementation()!;
    vi.mocked(attempts.saveAttempt).mockImplementationOnce(async (attempt) => {
      await commit.promise;
      await save(attempt);
    });
    const audio = createFakeAudioEngine();
    vi.mocked(audio.dispose).mockRejectedValueOnce(new Error('Audio close failed'));
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('last', 'K')],
      audioEngine: audio,
      attemptRepo: attempts,
      sessionRepo: createFakeSessionRepo()
    });
    await controller.start();
    answer(controller);
    let finished = false;
    const disposing = controller.dispose().catch((error) => {
      finished = true;
      expect(error.message).toBe('Audio close failed');
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    commit.resolve();
    await disposing;
    expect(finished).toBe(true);
    expect(controller.persistenceStatus).toBe('saved');
    expect(attempts.saved).toHaveLength(1);
  });

  it('does not hide a lost earlier answer behind later saves and retries in snapshot order', async () => {
    const attempts = createFakeAttemptRepo();
    vi.mocked(attempts.saveAttempt).mockRejectedValueOnce(new Error('Quota exceeded'));
    const sessions = createFakeSessionRepo();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('first', 'K'), createMockPrompt('second', 'M')],
      audioEngine: createFakeAudioEngine(),
      attemptRepo: attempts,
      sessionRepo: sessions
    });
    await controller.start();
    answer(controller, 'K');
    await controller.flushPersistence();
    answer(controller, 'M');
    expect(await controller.flushPersistence()).toBe(false);
    expect(controller.persistenceStatus).toBe('failed');
    expect(controller.persistenceError).toBe('Quota exceeded');
    expect(controller.attempts).toHaveLength(2);
    expect(attempts.saveAttempt).toHaveBeenCalledTimes(1);
    expect(sessions.updates).toEqual([]);
    expect(await controller.retryPersistence()).toBe(true);
    const ids = vi.mocked(attempts.saveAttempt).mock.calls.map(([attempt]) => attempt.id);
    expect(ids).toEqual([
      controller.attempts[0].id,
      controller.attempts[0].id,
      controller.attempts[1].id
    ]);
    expect(attempts.saved).toHaveLength(2);
    expect(sessions.updates.map(({ count, status }) => ({ count, status }))).toEqual([
      { count: 1, status: undefined },
      { count: 2, status: 'completed' }
    ]);
    expect(controller.persistenceError).toBeNull();
    expect(controller.persistenceStatus).toBe('saved');
    await controller.dispose();
  });

  it('counts introductions as completed prompts without creating recognition evidence', async () => {
    const intro = createMockPrompt('intro', 'K');
    intro.spec.kind = 'introduction';
    intro.isScored = false;
    const attempts = createFakeAttemptRepo();
    const sessions = createFakeSessionRepo();
    const audio = createFakeAudioEngine();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [intro, createMockPrompt('recall', 'K')],
      audioEngine: audio,
      attemptRepo: attempts,
      sessionRepo: sessions
    });
    await controller.start();
    expect(controller.continue()).toBe(false);
    expect(sessions.sessions[0].completedPromptCount).toBe(0);
    controller.play();
    expect(controller.continue()).toBe(false);
    audio.finish();
    controller.play();
    audio.finish();
    expect(controller.continue()).toBe(true);
    await controller.flushPersistence();
    expect(sessions.sessions[0].completedPromptCount).toBe(1);
    expect(attempts.saved).toHaveLength(0);
    answer(controller, 'K');
    await controller.flushPersistence();
    expect(sessions.sessions[0]).toMatchObject({
      status: 'completed',
      completedPromptCount: 2,
      promptCount: 2
    });
    expect(attempts.saved).toHaveLength(1);
    await controller.dispose();
  });

  it('retries an answer idempotently if its following progress update failed', async () => {
    const attempts = createFakeAttemptRepo();
    const sessions = createFakeSessionRepo();
    vi.mocked(sessions.updateSessionProgress).mockRejectedValueOnce(
      new Error('Transaction aborted')
    );
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('only', 'K')],
      audioEngine: createFakeAudioEngine(),
      attemptRepo: attempts,
      sessionRepo: sessions
    });
    await controller.start();
    answer(controller);
    expect(await controller.flushPersistence()).toBe(false);
    expect(attempts.saved).toHaveLength(1);
    expect(sessions.sessions[0].status).toBe('in-progress');
    expect(await controller.retryPersistence()).toBe(true);
    expect(attempts.saved).toHaveLength(1);
    expect(sessions.sessions[0]).toMatchObject({ status: 'completed', completedPromptCount: 1 });
    await controller.dispose();
  });

  it('does not mark completion saved when its own commit fails', async () => {
    const sessions = createFakeSessionRepo();
    const update = vi.mocked(sessions.updateSessionProgress).getMockImplementation()!;
    vi.mocked(sessions.updateSessionProgress).mockImplementation(async (...args) => {
      if (args[2] === 'completed') throw new Error('Completion aborted');
      await update(...args);
    });
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('only', 'K')],
      audioEngine: createFakeAudioEngine(),
      attemptRepo: createFakeAttemptRepo(),
      sessionRepo: sessions
    });
    await controller.start();
    answer(controller);
    expect(await controller.flushPersistence()).toBe(false);
    expect(controller.persistenceStatus).toBe('failed');
    expect(controller.phase).toBe('complete');
    vi.mocked(sessions.updateSessionProgress).mockImplementation(update);
    expect(await controller.retryPersistence()).toBe(true);
    expect(sessions.sessions[0].status).toBe('completed');
    await controller.dispose();
  });

  it('queues abandonment after an in-flight initial commit and never starts disposed playback', async () => {
    const initialCommit = deferred();
    const sessions = createFakeSessionRepo();
    const save = vi.mocked(sessions.saveSession).getMockImplementation()!;
    vi.mocked(sessions.saveSession).mockImplementationOnce(async (record) => {
      await initialCommit.promise;
      await save(record);
    });
    const audio = createFakeAudioEngine();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('only', 'K')],
      audioEngine: audio,
      attemptRepo: createFakeAttemptRepo(),
      sessionRepo: sessions
    });
    const starting = controller.start();
    controller.abandon();
    const disposing = controller.dispose();
    initialCommit.resolve();
    await Promise.all([starting, disposing]);
    expect(controller.phase).toBe('abandoned');
    expect(sessions.sessions[0].status).toBe('abandoned');
    expect(controller.persistenceStatus).toBe('saved');
    controller.play();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.listeners.size).toBe(0);
    expect(await controller.retryPersistence()).toBe(false);
  });
});

describe('coached review integration', () => {
  it('explicitly excludes progression and retries the same terminal record', async () => {
    const audio = createFakeAudioEngine();
    const attempts = createFakeAttemptRepo();
    const sessions = createFakeSessionRepo();
    let fail = true;
    const update = sessions.updateSessionProgress;
    sessions.updateSessionProgress = vi.fn(
      async (...args: Parameters<SessionRepository['updateSessionProgress']>) => {
        if (args[2] === 'completed' && fail) {
          fail = false;
          throw new Error('terminal unavailable');
        }
        await update(...args);
      }
    );
    const prompts = ['K', 'R'].map((character, i) => ({
      ...createMockPrompt(`review-${i}`, character),
      isScored: false,
      ordinal: i + 1
    }));
    const controller = new GuidedSessionController({
      step: 1,
      prompts,
      allowProgression: false,
      audioEngine: audio,
      attemptRepo: attempts,
      sessionRepo: sessions
    });
    await controller.start();
    for (const prompt of prompts) {
      controller.play();
      audio.finish();
      if (prompt.ordinal === 2) {
        controller.replay();
        audio.finish();
      }
      expect(controller.submitAnswer(prompt.spec.expectedText, 'keyboard')).toBe(true);
      expect(controller.submitAnswer(prompt.spec.expectedText, 'keyboard')).toBe(false);
      controller.continue();
    }
    expect(controller.summary?.unlockedNextStep).toBe(false);
    expect(controller.summary?.progressionReasonCode).toBe('free_practice_excluded');
    expect(await controller.flushPersistence()).toBe(false);
    const identity = controller.state.sessionId;
    expect(await controller.retryPersistence()).toBe(true);
    expect(attempts.saved).toHaveLength(2);
    expect(attempts.saved.every((a) => a.classification === 'unmeasured')).toBe(true);
    expect(attempts.saved[1].replayCount).toBe(1);
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]).toMatchObject({
      id: identity,
      status: 'completed',
      completedPromptCount: 2
    });
    await controller.dispose();
  });
});

describe('mixed-check controller boundary', () => {
  it('advances without revealing or auditioning feedback, including skipped answers', async () => {
    const audio = createFakeAudioEngine(),
      repo = createFakeAttemptRepo();
    const onPromptPlayback = vi.fn();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [
        { ...createMockPrompt('a', 'K'), isScored: false },
        { ...createMockPrompt('b', 'M'), isScored: false }
      ],
      audioEngine: audio,
      attemptRepo: repo,
      sessionRepo: createFakeSessionRepo(),
      allowProgression: false,
      feedback: 'after-check',
      onPromptPlayback
    });
    await controller.start();
    controller.play();
    audio.finish();
    expect(controller.submitAnswer('K', 'keyboard')).toBe(true);
    expect(controller.phase).toBe('ready');
    expect(controller.lastAttempt).toBeNull();
    controller.playFeedback('K');
    expect(audio.playedPlans).toHaveLength(1);
    controller.play();
    audio.finish();
    controller.submitAnswer('', 'keyboard');
    expect(controller.phase).toBe('complete');
    expect(controller.summary?.unlockedNextStep).toBe(false);
    await controller.flushPersistence();
    expect(repo.saved).toHaveLength(2);
    expect(onPromptPlayback).toHaveBeenCalledTimes(2);
    await controller.dispose();
  });
  it('recovers asynchronous audio/storage errors without enabling an answer', async () => {
    const audio = createFakeAudioEngine();
    const controller = new GuidedSessionController({
      step: 1,
      prompts: [createMockPrompt('a', 'K')],
      audioEngine: audio,
      attemptRepo: createFakeAttemptRepo(),
      sessionRepo: createFakeSessionRepo()
    });
    await controller.start();
    controller.play();
    for (const listener of audio.listeners) listener('error');
    expect(controller.phase).toBe('ready');
    expect(controller.submitAnswer('K', 'keyboard')).toBe(false);
    await controller.dispose();
  });
});

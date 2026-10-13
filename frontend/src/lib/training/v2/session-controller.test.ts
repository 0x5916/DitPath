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
      saved.push(a);
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
      sessions.push(s);
    }),
    getSession: vi.fn(async (id: string) => sessions.find((s) => s.id === id) ?? null),
    getLatestInProgressSession: vi.fn(async () => null),
    getSessions: vi.fn(async () => sessions),
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
    expect(fakeSessions.updateSessionProgress).toHaveBeenCalledWith(controller.state.sessionId, 1);

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

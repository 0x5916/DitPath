import { describe, expect, it } from 'vitest';
import {
  createGuidedSession,
  guidedSessionTransition,
  type GuidedSessionState
} from './guided-session';
import type { AttemptEvent, Prompt } from './types';

function createMockPrompt(
  id: string,
  kind: Prompt['spec']['kind'] = 'recall',
  expectedText = 'T'
): Prompt {
  return {
    id,
    ordinal: 1,
    isScored: kind === 'recall',
    spec: {
      kind,
      expectedText,
      characters: [expectedText],
      charWpm: 20,
      effWpm: 12,
      freqHz: 600
    }
  };
}

function createMockAttempt(promptId: string, isCorrect = true): AttemptEvent {
  return {
    schemaVersion: 1,
    id: `att_${promptId}`,
    sessionId: 'sess_1',
    promptId,
    promptKind: 'recall',
    targetCharacter: 'T',
    enteredText: 'T',
    isCorrect,
    classification: 'automatic',
    latencyMs: 1200,
    replayCount: 0,
    inputMode: 'keyboard',
    charWpm: 20,
    effWpm: 12,
    freqHz: 600,
    createdAt: '2026-10-04T12:00:00.000Z'
  };
}

describe('Guided Session State Machine', () => {
  it('initializes in idle state and transitions to ready or introducing on start', () => {
    const promptRecall = createMockPrompt('prm_1', 'recall', 'T');
    const state = createGuidedSession({
      sessionId: 'sess_1',
      step: 1,
      prompts: [promptRecall]
    });

    expect(state.phase).toBe('idle');
    expect(state.currentPromptIndex).toBe(0);

    const startTransition = guidedSessionTransition(state, { type: 'start' });
    expect(startTransition.ok).toBe(true);
    if (startTransition.ok) {
      expect(startTransition.state.phase).toBe('ready');
    }
  });

  it('transitions idle -> introducing if the first prompt is an introduction', () => {
    const promptIntro = createMockPrompt('prm_0', 'introduction', 'T');
    const state = createGuidedSession({
      sessionId: 'sess_1',
      step: 1,
      prompts: [promptIntro]
    });

    const startTransition = guidedSessionTransition(state, { type: 'start' });
    expect(startTransition.ok).toBe(true);
    if (startTransition.ok) {
      expect(startTransition.state.phase).toBe('introducing');
      const playing = guidedSessionTransition(startTransition.state, { type: 'play' });
      const ended = guidedSessionTransition(playing.state, { type: 'play-end', endedAtMs: 5000 });
      expect(ended.ok).toBe(true);
      if (ended.ok) {
        expect(ended.state.phase).toBe('introducing');
        expect(ended.state.answerReadyAtMs).toBe(5000);
        expect(ended.state.attempts).toEqual([]);
        expect(ended.effects).toEqual([]);
      }
    }
  });

  it('summarizes latency from correct scored attempts with rounded even medians', () => {
    const attempts = [
      { ...createMockAttempt('p1'), latencyMs: 1201 },
      { ...createMockAttempt('p2'), latencyMs: 1200 },
      { ...createMockAttempt('p3', false), latencyMs: 100 },
      { ...createMockAttempt('p4'), classification: 'unmeasured' as const, latencyMs: 0 }
    ];
    const state: GuidedSessionState = {
      ...createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [createMockPrompt('p1')] }),
      phase: 'feedback',
      attempts
    };
    const res = guidedSessionTransition(state, { type: 'continue' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.summary?.medianLatencyMs).toBe(1201);
      expect(res.state.summary?.scoredAttempts).toBe(3);
      expect(res.state.summary?.correctAttempts).toBe(2);
    }
    expect(attempts.map((attempt) => attempt.latencyMs)).toEqual([1201, 1200, 100, 0]);
  });

  it('executes play -> play-end -> answering lifecycle cleanly', () => {
    const prompt = createMockPrompt('prm_1', 'recall', 'T');
    let state = createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [prompt] });
    let res = guidedSessionTransition(state, { type: 'start' });
    expect(res.ok).toBe(true);
    state = res.state;

    // Play
    res = guidedSessionTransition(state, { type: 'play' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('playing');
      expect(res.effects).toEqual([{ kind: 'play-audio', prompt }]);
      state = res.state;
    }

    // Play-end
    res = guidedSessionTransition(state, { type: 'play-end', endedAtMs: 5000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('answering');
      expect(res.state.answerReadyAtMs).toBe(5000);
    }
  });

  it('increments replay count on replay from answering phase', () => {
    const prompt = createMockPrompt('prm_1', 'recall', 'T');
    const state: GuidedSessionState = {
      ...createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [prompt] }),
      phase: 'answering',
      currentPrompt: prompt,
      answerReadyAtMs: 1000
    };

    expect(state.replayCount).toBe(0);

    const res = guidedSessionTransition(state, { type: 'replay' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('playing');
      expect(res.state.replayCount).toBe(1);
    }
  });

  it('prevents double-submission and records attempt into feedback phase', () => {
    const prompt = createMockPrompt('prm_1', 'recall', 'T');
    let state: GuidedSessionState = {
      ...createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [prompt] }),
      phase: 'answering',
      currentPrompt: prompt,
      answerReadyAtMs: 1000
    };

    const attempt = createMockAttempt('prm_1', true);
    const submitRes = guidedSessionTransition(state, { type: 'submit-answer', attempt });
    expect(submitRes.ok).toBe(true);
    if (submitRes.ok) {
      expect(submitRes.state.phase).toBe('feedback');
      expect(submitRes.state.attempts.length).toBe(1);
      expect(submitRes.effects).toEqual([{ kind: 'record-attempt', attempt }]);
      state = submitRes.state;
    }

    // Double submit attempt must fail!
    const doubleSubmitRes = guidedSessionTransition(state, { type: 'submit-answer', attempt });
    expect(doubleSubmitRes.ok).toBe(false);
    if (!doubleSubmitRes.ok) {
      expect(doubleSubmitRes.reason).toContain('Cannot submit answer in phase');
    }
  });

  it('returns to ready state on audio-error without scoring prompt', () => {
    const prompt = createMockPrompt('prm_1', 'recall', 'T');
    const state: GuidedSessionState = {
      ...createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [prompt] }),
      phase: 'playing',
      currentPrompt: prompt
    };

    const res = guidedSessionTransition(state, {
      type: 'audio-error',
      error: 'AudioContext decode failed'
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('ready');
      expect(res.state.audioError).toBe('AudioContext decode failed');
      expect(res.state.attempts.length).toBe(0);
    }
  });

  it('supports pause and resume safely', () => {
    const prompt = createMockPrompt('prm_1', 'recall', 'T');
    let state: GuidedSessionState = {
      ...createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [prompt] }),
      phase: 'answering',
      currentPrompt: prompt,
      answerReadyAtMs: 1000
    };

    // Pause while answering
    let res = guidedSessionTransition(state, { type: 'pause' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('paused');
      expect(res.state.pausedFromPhase).toBe('answering');
      state = res.state;
    }

    // Resume returns to answering
    res = guidedSessionTransition(state, { type: 'resume' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('answering');
      expect(res.state.pausedFromPhase).toBeNull();
    }
  });

  it('advances through prompts and completes session with summary effect', () => {
    const p1 = createMockPrompt('prm_1', 'recall', 'K');
    const p2 = createMockPrompt('prm_2', 'recall', 'M');
    let state = createGuidedSession({
      sessionId: 'sess_1',
      step: 1,
      prompts: [p1, p2]
    });

    state = guidedSessionTransition(state, { type: 'start' }).state;
    state = guidedSessionTransition(state, { type: 'play' }).state;
    state = guidedSessionTransition(state, { type: 'play-end', endedAtMs: 2000 }).state;
    state = guidedSessionTransition(state, {
      type: 'submit-answer',
      attempt: createMockAttempt('prm_1')
    }).state;
    expect(state.phase).toBe('feedback');

    // Continue to prompt 2
    let res = guidedSessionTransition(state, { type: 'continue' });
    expect(res.ok).toBe(true);
    state = res.state;
    expect(state.phase).toBe('ready');
    expect(state.currentPromptIndex).toBe(1);
    expect(state.currentPrompt?.id).toBe('prm_2');

    // Complete prompt 2
    state = guidedSessionTransition(state, { type: 'play' }).state;
    state = guidedSessionTransition(state, { type: 'play-end', endedAtMs: 4000 }).state;
    state = guidedSessionTransition(state, {
      type: 'submit-answer',
      attempt: createMockAttempt('prm_2')
    }).state;

    // Continue finishes session
    res = guidedSessionTransition(state, { type: 'continue' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('complete');
      expect(res.state.summary).not.toBeNull();
      expect(res.state.summary?.sessionId).toBe('sess_1');
      expect(res.effects.some((e) => e.kind === 'session-complete')).toBe(true);
    }
  });

  it('allows abandoning an active session explicitly', () => {
    const prompt = createMockPrompt('prm_1', 'recall', 'T');
    const state: GuidedSessionState = {
      ...createGuidedSession({ sessionId: 'sess_1', step: 1, prompts: [prompt] }),
      phase: 'ready',
      currentPrompt: prompt
    };

    const res = guidedSessionTransition(state, { type: 'abandon' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toBe('abandoned');
      expect(res.effects).toEqual([{ kind: 'session-abandoned', sessionId: 'sess_1' }]);
    }
  });
});

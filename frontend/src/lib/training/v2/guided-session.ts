/**
 * Guided Session State Machine for DitPath V2.
 *
 * Models discrete prompt-by-prompt training according to the Koch method:
 * - Phases: idle -> introducing -> ready -> playing -> answering -> feedback -> complete / abandoned
 * - Reversible transitions: invalid transitions return an error verdict without mutating state.
 * - Idempotency: each prompt can produce at most one scored attempt event.
 * - Double-submit guard: submissions are rejected unless in 'answering' phase.
 * - Audio errors do not score prompts and return to a recoverable ready state.
 * - Single completion effect containing the full SessionSummary.
 */

import { evaluateProgression } from './progression';
import { calculateMedian } from './statistics';
import type { AttemptEvent, Prompt, SessionSummary } from './types';

export type GuidedSessionPhase =
  | 'idle'
  | 'introducing'
  | 'ready'
  | 'playing'
  | 'answering'
  | 'feedback'
  | 'paused'
  | 'complete'
  | 'abandoned';

export interface GuidedSessionState {
  phase: GuidedSessionPhase;
  sessionId: string;
  step: number;
  prompts: Prompt[];
  currentPromptIndex: number; // 0-based
  currentPrompt: Prompt | null;
  replayCount: number;
  /** Epoch milliseconds when prompt audio ended and input became active. */
  answerReadyAtMs: number | null;
  /** Attempts successfully scored in this session. */
  attempts: AttemptEvent[];
  /** Most recent attempt recorded during the session. */
  lastAttempt: AttemptEvent | null;
  /** Phase prior to pause for safe resumption. */
  pausedFromPhase: 'introducing' | 'ready' | 'playing' | 'answering' | null;
  summary: SessionSummary | null;
  audioError: string | null;
}

export type GuidedSessionEvent =
  | { type: 'start' }
  | { type: 'play' }
  | { type: 'play-end'; endedAtMs: number }
  | { type: 'audio-error'; error: string }
  | { type: 'replay' }
  | { type: 'submit-answer'; attempt: AttemptEvent }
  | { type: 'continue' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'abandon' };

export type GuidedSessionEffect =
  | { kind: 'play-audio'; prompt: Prompt }
  | { kind: 'record-attempt'; attempt: AttemptEvent }
  | { kind: 'session-complete'; summary: SessionSummary }
  | { kind: 'session-abandoned'; sessionId: string };

export type GuidedSessionTransition =
  | { ok: true; state: GuidedSessionState; effects: GuidedSessionEffect[] }
  | { ok: false; reason: string; state: GuidedSessionState };

export interface CreateGuidedSessionOptions {
  sessionId: string;
  step: number;
  prompts: Prompt[];
  initialAttempts?: AttemptEvent[];
  initialPromptIndex?: number;
}

/**
 * Initializes a new guided session.
 */
export function createGuidedSession(options: CreateGuidedSessionOptions): GuidedSessionState {
  if (options.prompts.length === 0) {
    throw new Error('Cannot create guided session with empty prompts array');
  }

  const initialIndex = options.initialPromptIndex ?? 0;
  const currentPrompt = options.prompts[initialIndex] ?? null;

  return {
    phase: 'idle',
    sessionId: options.sessionId,
    step: options.step,
    prompts: options.prompts,
    currentPromptIndex: initialIndex,
    currentPrompt,
    replayCount: 0,
    answerReadyAtMs: null,
    attempts: options.initialAttempts ?? [],
    lastAttempt: null,
    pausedFromPhase: null,
    summary: null,
    audioError: null
  };
}

/**
 * Pure transition reducer for the guided session state machine.
 */
export function guidedSessionTransition(
  state: GuidedSessionState,
  event: GuidedSessionEvent,
  allHistoricalAttempts: AttemptEvent[] = [],
  nowIso = new Date().toISOString()
): GuidedSessionTransition {
  switch (event.type) {
    case 'start': {
      if (state.phase !== 'idle') {
        return { ok: false, reason: `Cannot start session from phase '${state.phase}'`, state };
      }

      const prompt = state.currentPrompt;
      if (!prompt) {
        return { ok: false, reason: 'No prompt available to start', state };
      }

      const isIntro = prompt.spec.kind === 'introduction';
      const nextPhase: GuidedSessionPhase = isIntro ? 'introducing' : 'ready';

      return {
        ok: true,
        state: {
          ...state,
          phase: nextPhase,
          replayCount: 0,
          audioError: null
        },
        effects: []
      };
    }

    case 'play': {
      if (state.phase !== 'ready' && state.phase !== 'introducing' && state.phase !== 'answering') {
        return { ok: false, reason: `Cannot play audio from phase '${state.phase}'`, state };
      }

      if (!state.currentPrompt) {
        return { ok: false, reason: 'No active prompt to play', state };
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: 'playing',
          audioError: null
        },
        effects: [{ kind: 'play-audio', prompt: state.currentPrompt }]
      };
    }

    case 'play-end': {
      if (state.phase !== 'playing') {
        return { ok: false, reason: `Unexpected play-end in phase '${state.phase}'`, state };
      }

      const isIntro = state.currentPrompt?.spec.kind === 'introduction';
      return {
        ok: true,
        state: {
          ...state,
          phase: isIntro ? 'introducing' : 'answering',
          answerReadyAtMs: event.endedAtMs
        },
        effects: []
      };
    }

    case 'replay': {
      if (state.phase !== 'answering') {
        return { ok: false, reason: `Cannot replay audio from phase '${state.phase}'`, state };
      }
      if (!state.currentPrompt) {
        return { ok: false, reason: 'No active prompt to replay', state };
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: 'playing',
          replayCount: state.replayCount + 1,
          audioError: null
        },
        effects: [{ kind: 'play-audio', prompt: state.currentPrompt }]
      };
    }

    case 'audio-error': {
      if (state.phase !== 'playing' && state.phase !== 'ready') {
        return { ok: false, reason: `Cannot report audio error in phase '${state.phase}'`, state };
      }

      // Return to ready state; prompt is NOT scored
      return {
        ok: true,
        state: {
          ...state,
          phase: 'ready',
          audioError: event.error
        },
        effects: []
      };
    }

    case 'submit-answer': {
      if (state.phase !== 'answering') {
        return {
          ok: false,
          reason: `Cannot submit answer in phase '${state.phase}' (already submitted or not answerable)`,
          state
        };
      }

      // Guard against duplicate prompt scoring
      const alreadyScored = state.attempts.some((a) => a.promptId === event.attempt.promptId);
      if (alreadyScored) {
        return {
          ok: false,
          reason: `Prompt '${event.attempt.promptId}' has already been scored`,
          state
        };
      }

      const updatedAttempts = [...state.attempts, event.attempt];

      return {
        ok: true,
        state: {
          ...state,
          phase: 'feedback',
          attempts: updatedAttempts,
          lastAttempt: event.attempt
        },
        effects: [{ kind: 'record-attempt', attempt: event.attempt }]
      };
    }

    case 'continue': {
      if (state.phase !== 'feedback' && state.phase !== 'introducing') {
        return {
          ok: false,
          reason: `Cannot continue from phase '${state.phase}'`,
          state
        };
      }

      const nextIndex = state.currentPromptIndex + 1;
      const isFinished = nextIndex >= state.prompts.length;

      if (isFinished) {
        // Complete the session: compute SessionSummary & progression
        const progression = evaluateProgression(state.step, state.attempts, allHistoricalAttempts, {
          nowIso
        });

        const scoredAttempts = state.attempts.filter((a) => a.classification !== 'unmeasured');
        const correctAttempts = scoredAttempts.filter((a) => a.isCorrect).length;
        const accuracy =
          scoredAttempts.length > 0
            ? Math.round((correctAttempts / scoredAttempts.length) * 1000) / 1000
            : 0;

        const latencies = scoredAttempts.filter((a) => a.isCorrect).map((a) => a.latencyMs);
        const medianLatencyMs = calculateMedian(latencies);

        const totalReplays = state.attempts.reduce((sum, a) => sum + a.replayCount, 0);

        const summary: SessionSummary = {
          sessionId: state.sessionId,
          step: state.step,
          totalAttempts: state.attempts.length,
          scoredAttempts: scoredAttempts.length,
          correctAttempts,
          accuracy,
          medianLatencyMs,
          totalReplays,
          strongCharacters: [],
          weakCharacters: progression.weakCharacters,
          unlockedNextStep: progression.canUnlock,
          progressionReasonCode: progression.reasonCode,
          completedAt: nowIso
        };

        return {
          ok: true,
          state: {
            ...state,
            phase: 'complete',
            currentPromptIndex: nextIndex,
            currentPrompt: null,
            summary
          },
          effects: [{ kind: 'session-complete', summary }]
        };
      }

      // Advance to next prompt
      const nextPrompt = state.prompts[nextIndex];
      const nextIsIntro = nextPrompt.spec.kind === 'introduction';

      return {
        ok: true,
        state: {
          ...state,
          phase: nextIsIntro ? 'introducing' : 'ready',
          currentPromptIndex: nextIndex,
          currentPrompt: nextPrompt,
          replayCount: 0,
          answerReadyAtMs: null,
          lastAttempt: null,
          audioError: null
        },
        effects: []
      };
    }

    case 'pause': {
      if (
        state.phase !== 'introducing' &&
        state.phase !== 'ready' &&
        state.phase !== 'playing' &&
        state.phase !== 'answering'
      ) {
        return { ok: false, reason: `Cannot pause from phase '${state.phase}'`, state };
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: 'paused',
          pausedFromPhase: state.phase
        },
        effects: []
      };
    }

    case 'resume': {
      if (state.phase !== 'paused') {
        return { ok: false, reason: `Cannot resume from phase '${state.phase}'`, state };
      }

      // If paused while playing, return to ready so user can hear again without jump
      let resumePhase: GuidedSessionPhase = state.pausedFromPhase ?? 'ready';
      if (resumePhase === 'playing') {
        resumePhase = 'ready';
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: resumePhase,
          pausedFromPhase: null
        },
        effects: []
      };
    }

    case 'abandon': {
      if (state.phase === 'complete' || state.phase === 'abandoned') {
        return { ok: false, reason: `Cannot abandon finished session in '${state.phase}'`, state };
      }

      return {
        ok: true,
        state: {
          ...state,
          phase: 'abandoned'
        },
        effects: [{ kind: 'session-abandoned', sessionId: state.sessionId }]
      };
    }
  }
}

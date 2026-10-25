/**
 * Prompt-level scoring and response classification for DitPath V2.
 *
 * Guarantees:
 * - Correctness is recorded independently from recognition speed.
 * - Correct-but-slow answers remain correct (classified as 'developing').
 * - Audio replays do not mark answers incorrect.
 * - Negative latencies and impossible timestamps are rejected.
 * - Normalizes case and whitespace; supports punctuation symbols.
 * - The existing continuous-passage CER scorer in `#lib/score.ts` remains untouched.
 */

import { createAttemptId } from './ids';
import {
  DEFAULT_MASTERY_POLICY,
  V2_SCHEMA_VERSION,
  type AttemptClassification,
  type AttemptEvent,
  type InputMode,
  type MasteryPolicy,
  type Prompt
} from './types';

export interface ScorePromptInput {
  prompt: Prompt;
  sessionId: string;
  enteredText: string;
  /** Epoch milliseconds when audio finished and prompt became answerable. */
  answerReadyAtMs: number;
  /** Epoch milliseconds when user submitted the answer. */
  submittedAtMs: number;
  replayCount: number;
  inputMode: InputMode;
  policy?: MasteryPolicy;
  idGenerator?: () => string;
  nowIso?: string;
}

export function normalizeAnswerText(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * Evaluates a single prompt submission and produces an immutable AttemptEvent.
 */
export function scorePromptAttempt(input: ScorePromptInput): AttemptEvent {
  const {
    prompt,
    sessionId,
    enteredText,
    answerReadyAtMs,
    submittedAtMs,
    replayCount,
    inputMode,
    policy = DEFAULT_MASTERY_POLICY,
    idGenerator = () => createAttemptId(),
    nowIso = new Date().toISOString()
  } = input;

  if (submittedAtMs < answerReadyAtMs) {
    throw new Error(
      `Invalid timing: submittedAt (${submittedAtMs}) cannot precede answerReadyAt (${answerReadyAtMs})`
    );
  }

  if (replayCount < 0 || !Number.isInteger(replayCount)) {
    throw new Error(`Invalid replayCount: must be non-negative integer, got ${replayCount}`);
  }

  const latencyMs = Math.round(submittedAtMs - answerReadyAtMs);
  const normalizedEntered = normalizeAnswerText(enteredText);
  const normalizedExpected = normalizeAnswerText(prompt.spec.expectedText);

  const isEmpty = normalizedEntered === '';
  const isCorrect = !isEmpty && normalizedEntered === normalizedExpected;

  let classification: AttemptClassification;

  if (!prompt.isScored) {
    classification = 'unmeasured';
  } else if (isEmpty) {
    classification = 'missing';
  } else if (!isCorrect) {
    classification = 'incorrect';
  } else if (latencyMs <= policy.maxAutomaticLatencyMs) {
    classification = 'automatic';
  } else {
    // Correct-but-slow: remains correct!
    classification = 'developing';
  }

  return {
    schemaVersion: V2_SCHEMA_VERSION,
    id: idGenerator(),
    sessionId,
    promptId: prompt.id,
    promptKind: prompt.spec.kind,
    targetCharacter: prompt.spec.expectedText,
    enteredText: normalizedEntered,
    isCorrect,
    classification,
    latencyMs,
    replayCount,
    inputMode,
    charWpm: prompt.spec.charWpm,
    effWpm: prompt.spec.effWpm,
    freqHz: prompt.spec.freqHz,
    createdAt: nowIso
  };
}

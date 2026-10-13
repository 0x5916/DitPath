/**
 * Character Mastery Reducer for DitPath V2.
 *
 * Derives explainable character-level mastery from immutable AttemptEvents:
 * - Pure function: depends strictly on attempts, policy configuration, and clock.
 * - Enforces two-session rule: multiple attempts within a single session can never satisfy stability.
 * - Rolling window for accuracy and latency calculation.
 * - Distinguishes speed automaticity from accuracy: slow correct answers raise accuracy but not speed.
 * - Identifies review-due characters when time elapsed exceeds reviewIntervalDays.
 */

import { calculateMedian } from './statistics';
import {
  DEFAULT_MASTERY_POLICY,
  type AttemptEvent,
  type CharacterMastery,
  type MasteryPolicy,
  type MasteryStatus
} from './types';

export interface ReduceMasteryOptions {
  policy?: MasteryPolicy;
  nowIso?: string;
}

export type MasteryBlocker = 'attempts' | 'sessions' | 'accuracy' | 'speed' | 'review';

/** Explains the existing mastery gates without changing the learning policy. */
export function getMasteryBlockers(
  mastery: CharacterMastery,
  policy: MasteryPolicy = DEFAULT_MASTERY_POLICY
): MasteryBlocker[] {
  const blockers: MasteryBlocker[] = [];
  if (mastery.totalAttempts < policy.minAttemptsForStability) blockers.push('attempts');
  if (mastery.sessionCount < policy.minSessionsForStability) blockers.push('sessions');
  if (mastery.rollingAccuracy < policy.targetAccuracy) blockers.push('accuracy');
  if (mastery.medianLatencyMs === null || mastery.medianLatencyMs > policy.maxAutomaticLatencyMs) {
    blockers.push('speed');
  }
  if (mastery.status === 'review') blockers.push('review');
  return blockers;
}

/**
 * Reduces a history snapshot with one indexing pass and one reduction per distinct symbol.
 * Result keys preserve the requested spelling and share one evaluation time.
 * Use the single-character reducer when an incremental scan can stop early.
 */
export function reduceCharacterMasteries(
  characters: readonly string[],
  allAttempts: readonly AttemptEvent[],
  options: ReduceMasteryOptions = {}
): Map<string, CharacterMastery> {
  if (characters.length === 0) return new Map();
  const snapshotOptions = { ...options, nowIso: options.nowIso ?? new Date().toISOString() };
  const attemptsByCharacter = new Map<string, AttemptEvent[]>();
  for (const attempt of allAttempts) {
    if (attempt.classification === 'unmeasured') continue;
    const key = attempt.targetCharacter.toUpperCase();
    const bucket = attemptsByCharacter.get(key);
    if (bucket) bucket.push(attempt);
    else attemptsByCharacter.set(key, [attempt]);
  }

  const normalizedMasteries = new Map<string, CharacterMastery>();
  const results = new Map<string, CharacterMastery>();
  for (const character of new Set(characters)) {
    const key = character.toUpperCase();
    let mastery = normalizedMasteries.get(key);
    if (!mastery) {
      mastery = reduceCharacterMastery(
        character,
        attemptsByCharacter.get(key) ?? [],
        snapshotOptions
      );
      normalizedMasteries.set(key, mastery);
    }
    results.set(character, mastery.character === character ? mastery : { ...mastery, character });
  }
  return results;
}

/**
 * Calculates character mastery metrics and status from attempt history.
 */
export function reduceCharacterMastery(
  character: string,
  allAttempts: readonly AttemptEvent[],
  options: ReduceMasteryOptions = {}
): CharacterMastery {
  const policy = options.policy ?? DEFAULT_MASTERY_POLICY;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  // Filter scored attempts targeting this character
  const charAttempts = allAttempts
    .filter(
      (a) =>
        a.targetCharacter.toUpperCase() === character.toUpperCase() &&
        a.classification !== 'unmeasured'
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const totalAttempts = charAttempts.length;

  if (totalAttempts === 0) {
    return {
      character,
      status: 'new',
      totalAttempts: 0,
      correctAttempts: 0,
      rollingAccuracy: 0,
      medianLatencyMs: null,
      replayRate: 0,
      sessionCount: 0,
      lastPractisedAt: null,
      dueForReviewAt: null,
      updatedAt: nowIso
    };
  }

  const correctAttempts = charAttempts.filter((a) => a.isCorrect).length;
  const distinctSessions = new Set(charAttempts.map((a) => a.sessionId));
  const sessionCount = distinctSessions.size;

  // Rolling window over most recent attempts
  const windowStart = Math.max(0, totalAttempts - policy.rollingWindowSize);
  const windowAttempts = charAttempts.slice(windowStart);
  const windowCount = windowAttempts.length;

  const windowCorrect = windowAttempts.filter((a) => a.isCorrect).length;
  const rollingAccuracy = windowCount > 0 ? windowCorrect / windowCount : 0;

  const correctLatencies = windowAttempts.filter((a) => a.isCorrect).map((a) => a.latencyMs);

  const medianLatencyMs = calculateMedian(correctLatencies);

  const replaysInWindow = windowAttempts.filter((a) => a.replayCount > 0).length;
  const replayRate = windowCount > 0 ? replaysInWindow / windowCount : 0;

  const lastPractisedAt = charAttempts[totalAttempts - 1].createdAt;
  const lastPractisedMs = Date.parse(lastPractisedAt);

  // Calculate review due timestamp
  const reviewDueMs = lastPractisedMs + policy.reviewIntervalDays * 86400000;
  const dueForReviewAt = new Date(reviewDueMs).toISOString();
  const isOverdue = nowMs >= reviewDueMs;

  // Determine MasteryStatus:
  // Stability requires:
  // 1. Min total attempts
  // 2. Multi-session proof (>= minSessions)
  // 3. High rolling accuracy (>= targetAccuracy)
  // 4. Low latency (<= maxAutomaticLatencyMs)
  const hasMinAttempts = totalAttempts >= policy.minAttemptsForStability;
  const hasMultiSession = sessionCount >= policy.minSessionsForStability;
  const hasAccuracy = rollingAccuracy >= policy.targetAccuracy;
  const hasAutomaticSpeed =
    medianLatencyMs !== null && medianLatencyMs <= policy.maxAutomaticLatencyMs;

  let status: MasteryStatus;

  if (hasMinAttempts && hasMultiSession && hasAccuracy && hasAutomaticSpeed) {
    status = isOverdue ? 'review' : 'stable';
  } else {
    status = 'learning';
  }

  return {
    character,
    status,
    totalAttempts,
    correctAttempts,
    rollingAccuracy: Math.round(rollingAccuracy * 1000) / 1000,
    medianLatencyMs,
    replayRate: Math.round(replayRate * 1000) / 1000,
    sessionCount,
    lastPractisedAt,
    dueForReviewAt,
    updatedAt: nowIso
  };
}

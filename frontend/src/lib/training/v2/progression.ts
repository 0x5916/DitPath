/**
 * Progression Decision Engine for DitPath V2.
 *
 * Evaluates whether a completed training session satisfies the Koch method criteria
 * to unlock the next character, requires review of struggling symbols, or continues
 * training the current step.
 *
 * Invariants:
 * - Free practice never unlocks course progression.
 * - Aggregate score alone is not enough: a weak individual character blocks unlocking.
 * - Multi-session stability is required to unlock subsequent steps.
 * - Generates structured reason codes suitable for UI localization.
 */

import { LESSONS, getLessonChars } from '../sequence';
import { reduceCharacterMasteries } from './mastery';
import { DEFAULT_MASTERY_POLICY, type AttemptEvent, type MasteryPolicy } from './types';

export type ProgressionAction = 'unlock-next' | 'review' | 'continue';

export type ProgressionReasonCode =
  | 'unlocked_next_character'
  | 'all_curriculum_completed'
  | 'free_practice_excluded'
  | 'overall_accuracy_too_low'
  | 'introduced_character_unstable'
  | 'weak_character_detected'
  | 'insufficient_attempts'
  | 'insufficient_sessions';

export interface ProgressionDecision {
  action: ProgressionAction;
  reasonCode: ProgressionReasonCode;
  currentStep: number;
  nextStep: number | null;
  unlockedCharacter?: string;
  weakCharacters: string[];
  canUnlock: boolean;
  sessionAccuracy: number;
}

export interface EvaluateProgressionOptions {
  policy?: MasteryPolicy;
  isFreePractice?: boolean;
  nowIso?: string;
}

/**
 * Evaluates progression criteria after a training session.
 */
export function evaluateProgression(
  currentStep: number,
  sessionAttempts: AttemptEvent[],
  allHistoricalAttempts: AttemptEvent[],
  options: EvaluateProgressionOptions = {}
): ProgressionDecision {
  const policy = options.policy ?? DEFAULT_MASTERY_POLICY;
  const isFreePractice = options.isFreePractice ?? false;
  const nowIso = options.nowIso ?? new Date().toISOString();

  const scoredSessionAttempts = sessionAttempts.filter((a) => a.classification !== 'unmeasured');

  const sessionTotal = scoredSessionAttempts.length;
  const sessionCorrect = scoredSessionAttempts.filter((a) => a.isCorrect).length;
  const sessionAccuracy =
    sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 1000) / 1000 : 0;

  // 1. Free practice rule: free practice NEVER unlocks course steps
  if (isFreePractice) {
    return {
      action: 'continue',
      reasonCode: 'free_practice_excluded',
      currentStep,
      nextStep: null,
      weakCharacters: [],
      canUnlock: false,
      sessionAccuracy
    };
  }

  // 2. Minimum attempt threshold for this session
  if (sessionTotal < 6) {
    return {
      action: 'continue',
      reasonCode: 'insufficient_attempts',
      currentStep,
      nextStep: null,
      weakCharacters: [],
      canUnlock: false,
      sessionAccuracy
    };
  }

  // 3. Overall session accuracy threshold
  if (sessionAccuracy < policy.targetAccuracy) {
    return {
      action: 'continue',
      reasonCode: 'overall_accuracy_too_low',
      currentStep,
      nextStep: null,
      weakCharacters: [],
      canUnlock: false,
      sessionAccuracy
    };
  }

  // 4. Character-level analysis across active set
  const activeChars = getLessonChars(currentStep).split('');
  const introducedChars = LESSONS[currentStep - 1]?.split('') ?? [];

  // Group all attempts (history + current session) by character
  const combinedAttempts = [...allHistoricalAttempts, ...sessionAttempts];
  const characterMasteries = reduceCharacterMasteries(activeChars, combinedAttempts, {
    policy,
    nowIso
  });
  const weakChars: string[] = [];

  for (const ch of activeChars) {
    const mastery = characterMasteries.get(ch)!;

    // Look at session performance for this specific character
    const charSessionAttempts = scoredSessionAttempts.filter(
      (a) => a.targetCharacter.toUpperCase() === ch.toUpperCase()
    );

    if (charSessionAttempts.length >= 2) {
      const charCorrect = charSessionAttempts.filter((a) => a.isCorrect).length;
      const charAcc = charCorrect / charSessionAttempts.length;
      if (charAcc < 0.7) {
        weakChars.push(ch);
      }
    } else if (mastery.status === 'review') {
      weakChars.push(ch);
    }
  }

  // If any character is struggling, block unlock and recommend targeted review
  if (weakChars.length > 0) {
    return {
      action: 'review',
      reasonCode: 'weak_character_detected',
      currentStep,
      nextStep: null,
      weakCharacters: weakChars,
      canUnlock: false,
      sessionAccuracy
    };
  }

  // 5. Verify the introduced character(s) have sufficient evidence
  for (const introChar of introducedChars) {
    const introMastery = characterMasteries.get(introChar)!;

    if (introMastery.sessionCount < policy.minSessionsForStability) {
      return {
        action: 'continue',
        reasonCode: 'insufficient_sessions',
        currentStep,
        nextStep: null,
        weakCharacters: [],
        canUnlock: false,
        sessionAccuracy
      };
    }

    if (
      introMastery.totalAttempts < policy.minAttemptsForStability ||
      introMastery.rollingAccuracy < policy.targetAccuracy ||
      introMastery.medianLatencyMs === null ||
      introMastery.medianLatencyMs > policy.maxAutomaticLatencyMs
    ) {
      return {
        action: 'continue',
        reasonCode: 'introduced_character_unstable',
        currentStep,
        nextStep: null,
        weakCharacters: [introChar],
        canUnlock: false,
        sessionAccuracy
      };
    }
  }

  // 6. All criteria met: unlock next step or acknowledge curriculum completion
  if (currentStep >= LESSONS.length) {
    return {
      action: 'continue',
      reasonCode: 'all_curriculum_completed',
      currentStep,
      nextStep: null,
      weakCharacters: [],
      canUnlock: false,
      sessionAccuracy
    };
  }

  const nextStep = currentStep + 1;
  const unlockedCharacter = LESSONS[nextStep - 1];

  return {
    action: 'unlock-next',
    reasonCode: 'unlocked_next_character',
    currentStep,
    nextStep,
    unlockedCharacter,
    weakCharacters: [],
    canUnlock: true,
    sessionAccuracy
  };
}

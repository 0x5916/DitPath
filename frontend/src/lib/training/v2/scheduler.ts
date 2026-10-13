/**
 * Adaptive Review Scheduler for DitPath V2.
 *
 * Prioritizes learning and review symbols based on concrete evidence:
 * - Newly introduced characters
 * - Due review symbols
 * - Recent recognition errors
 * - Slow correct recognition (latency > 2000ms)
 * - Confused character pairs
 * - Maintenance review for stable symbols
 * - Strong penalty against immediate repetition (avoids repeating exact failed prompts immediately)
 *
 * Deterministic with injected random source.
 */

import type { CharacterMastery, ConfusionPair, AttemptEvent } from './types';

export type SchedulingReasonCode =
  | 'new-introduction'
  | 'due-review'
  | 'recent-error'
  | 'slow-recognition'
  | 'confusion-pair'
  | 'maintenance-review';

export interface ScheduledCharacter {
  character: string;
  weight: number;
  reasonCode: SchedulingReasonCode;
}

export interface SchedulerOptions {
  lastCharacter?: string;
  recentAttemptsWindow?: number;
  random?: () => number;
}

/**
 * Calculates adaptive weights and explanatory reason codes for candidate symbols.
 */
export function calculateCharacterWeights(
  activeCharacters: string[],
  masteryMap: Map<string, CharacterMastery>,
  recentAttempts: AttemptEvent[],
  confusionPairs: ConfusionPair[] = [],
  options: SchedulerOptions = {}
): ScheduledCharacter[] {
  const windowSize = options.recentAttemptsWindow ?? 15;
  const recentWindow = recentAttempts.slice(-windowSize);

  // Identify characters with recent errors in the window
  const recentErrorChars = new Set(
    recentWindow.filter((a) => !a.isCorrect).map((a) => a.targetCharacter.toUpperCase())
  );

  // Identify characters involved in confusion pairs
  const confusedChars = new Set<string>();
  for (const pair of confusionPairs) {
    if (pair.confusionCount >= 2) {
      confusedChars.add(pair.expected.toUpperCase());
      confusedChars.add(pair.actual.toUpperCase());
    }
  }

  const results: ScheduledCharacter[] = [];

  for (const rawChar of activeCharacters) {
    const char = rawChar.toUpperCase();
    const mastery = masteryMap.get(char);

    let weight: number;
    let reasonCode: SchedulingReasonCode;

    if (!mastery || mastery.status === 'new') {
      weight = 5.0;
      reasonCode = 'new-introduction';
    } else if (mastery.status === 'review') {
      weight = 4.0;
      reasonCode = 'due-review';
    } else if (recentErrorChars.has(char)) {
      weight = 3.5;
      reasonCode = 'recent-error';
    } else if (confusedChars.has(char)) {
      weight = 3.0;
      reasonCode = 'confusion-pair';
    } else if (mastery.medianLatencyMs !== null && mastery.medianLatencyMs > 2000) {
      weight = 2.5;
      reasonCode = 'slow-recognition';
    } else if (mastery.status === 'learning') {
      weight = 2.0;
      reasonCode = 'new-introduction';
    } else {
      // Stable symbol: maintenance review
      weight = 1.0;
      reasonCode = 'maintenance-review';
    }

    // Anti-repetition penalty: downweight if this was the immediately preceding prompt
    if (options.lastCharacter && options.lastCharacter.toUpperCase() === char) {
      weight *= 0.1;
    }

    results.push({
      character: char,
      weight: Math.max(0.01, Math.round(weight * 100) / 100),
      reasonCode
    });
  }

  return results;
}

/**
 * Selects the next prompt character adaptively using weighted sampling.
 */
export function selectNextCharacter(
  activeCharacters: string[],
  masteryMap: Map<string, CharacterMastery>,
  recentAttempts: AttemptEvent[],
  confusionPairs: ConfusionPair[] = [],
  options: SchedulerOptions = {}
): ScheduledCharacter {
  if (activeCharacters.length === 0) {
    throw new Error('Cannot select next character from empty active set');
  }
  if (activeCharacters.length === 1) {
    return {
      character: activeCharacters[0].toUpperCase(),
      weight: 1.0,
      reasonCode: 'maintenance-review'
    };
  }

  const candidates = calculateCharacterWeights(
    activeCharacters,
    masteryMap,
    recentAttempts,
    confusionPairs,
    options
  );

  const random = options.random ?? Math.random;
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let threshold = random() * totalWeight;

  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold <= 0) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

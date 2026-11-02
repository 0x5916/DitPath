import { LESSONS } from '../sequence';
import { getHistoricalStability, reduceCharacterMastery } from './mastery';
import { DEFAULT_MASTERY_POLICY, type AttemptEvent, type CharacterMastery } from './types';

export type CoursePathItemStatus =
  'stable' | 'current' | 'review' | 'available' | 'locked' | 'legacy-unverified';

/** Presentation status derived from unlock history, separate from current mastery. */
export function deriveCoursePathItemStatus(
  step: number,
  characters: string,
  input: {
    currentStep: number;
    unlockedStep: number;
    masteryMap: ReadonlyMap<string, CharacterMastery>;
    suggestedStep?: number;
  }
): CoursePathItemStatus {
  if (step > input.unlockedStep) {
    if (input.suggestedStep && step <= input.suggestedStep) return 'legacy-unverified';
    return 'locked';
  }
  if (step === input.currentStep) return 'current';
  const charList = characters.split('');
  if (charList.some((character) => input.masteryMap.get(character)?.status === 'review'))
    return 'review';
  if (charList.every((character) => input.masteryMap.get(character)?.status === 'stable'))
    return 'stable';
  return 'available';
}

export interface CourseGuidanceOptions {
  /**
   * Complete recorded history for historical unlocks. Current proficiency and
   * review readiness still come from `attempts` (the caller's recent window).
   */
  history?: readonly AttemptEvent[];
}

/**
 * Separates three facts that must not be conflated:
 * - historical progression: which lessons were ever legitimately unlocked;
 * - current proficiency and review readiness: which symbols are stable now;
 * - the recommended lesson: the first lesson not yet historically completed.
 *
 * Unlocks are monotonic. Inactivity, a due review, or a later mistake may
 * change current proficiency, but never relocks a lesson that was earned.
 */
export function deriveCourseGuidance(
  attempts: readonly AttemptEvent[],
  nowIso: string,
  lessons: readonly string[] = LESSONS,
  options: CourseGuidanceOptions = {}
) {
  const history = options.history ?? attempts;
  const masteryMap = new Map<string, CharacterMastery>();
  const reviewChars: string[] = [];
  let currentStep = 1;

  for (let index = 0; index < lessons.length; index++) {
    let achieved = true;
    for (const character of lessons[index]) {
      const mastery = reduceCharacterMastery(character, attempts, { nowIso });
      masteryMap.set(character, mastery);
      if (mastery.status === 'review') reviewChars.push(character);
      if (!getHistoricalStability(character, history, DEFAULT_MASTERY_POLICY).achieved)
        achieved = false;
    }
    currentStep = index + 1;
    if (!achieved)
      return {
        currentStep,
        unlockedStep: currentStep,
        masteryMap,
        reviewChars,
        courseComplete: false
      };
  }

  return {
    currentStep,
    unlockedStep: lessons.length,
    masteryMap,
    reviewChars,
    courseComplete: lessons.length > 0
  };
}

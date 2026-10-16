import { LESSONS } from '../sequence';
import { reduceCharacterMastery } from './mastery';
import type { AttemptEvent, CharacterMastery } from './types';

/** Stops at the first unstable lesson; unlocking the final lesson is not completion. */
export function deriveCourseGuidance(
  attempts: readonly AttemptEvent[],
  nowIso: string,
  lessons: readonly string[] = LESSONS
) {
  const masteryMap = new Map<string, CharacterMastery>();
  const reviewChars: string[] = [];
  let currentStep = 1;

  for (let index = 0; index < lessons.length; index++) {
    let stable = true;
    for (const character of lessons[index]) {
      const mastery = reduceCharacterMastery(character, attempts, { nowIso });
      masteryMap.set(character, mastery);
      if (mastery.status === 'review') reviewChars.push(character);
      if (mastery.status !== 'stable') stable = false;
    }
    currentStep = index + 1;
    if (!stable) return { currentStep, masteryMap, reviewChars, courseComplete: false };
  }

  return { currentStep, masteryMap, reviewChars, courseComplete: lessons.length > 0 };
}

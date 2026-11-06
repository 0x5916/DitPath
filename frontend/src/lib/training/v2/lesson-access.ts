import { LESSONS } from '../sequence';
import { deriveCourseGuidance } from './course-guidance';
import type { Recommendation } from '../learning-policy/recommendation';
import type { AttemptEvent } from './types';

export interface GuidedLessonAccess {
  currentStep: number;
  unlockedStep: number;
  courseComplete: boolean;
}

/**
 * The guided course owns lesson access. Learning evidence can recommend a next
 * lesson, but it does not unlock one by itself.
 */
export function deriveGuidedLessonAccess(
  attempts: readonly AttemptEvent[],
  nowIso: string,
  lessons: readonly string[] = LESSONS
): GuidedLessonAccess {
  const guidance = deriveCourseGuidance(attempts, nowIso, lessons, { history: attempts });
  return {
    currentStep: guidance.currentStep,
    unlockedStep: guidance.unlockedStep,
    courseComplete: guidance.courseComplete
  };
}

export function isGuidedLessonUnlocked(step: number, access: GuidedLessonAccess): boolean {
  return Number.isInteger(step) && step >= 1 && step <= access.unlockedStep;
}

/** A learning-evidence "new lesson" action must obey the guided unlock state. */
export function isRecommendationLessonLocked(
  recommendation: Recommendation,
  unlockedStep: number
): boolean {
  return (
    recommendation.reason === 'new-lesson' &&
    recommendation.lesson !== null &&
    recommendation.lesson > unlockedStep
  );
}

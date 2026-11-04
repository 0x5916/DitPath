import { LESSONS } from '../training/sequence';
import type { HomeDashboard } from './home-dashboard';

/**
 * Guided Lessons owns the course action. Recall recommendations must never
 * choose its lesson or manufacture an unlock.
 */
export type HomeCourseAction =
  | { kind: 'unfinished'; step: number; characters: string }
  | { kind: 'complete' }
  | { kind: 'start'; step: number; characters: string; reviewChars: string[] };

export function homeCourseAction(
  dashboard: Pick<HomeDashboard, 'unfinishedSession' | 'guidance'>
): HomeCourseAction {
  const step = Math.min(
    Math.max(1, dashboard.unfinishedSession?.step ?? dashboard.guidance.currentStep),
    LESSONS.length
  );
  if (dashboard.unfinishedSession)
    return { kind: 'unfinished', step, characters: LESSONS[step - 1] };
  if (dashboard.guidance.courseComplete) return { kind: 'complete' };
  return {
    kind: 'start',
    step,
    characters: LESSONS[step - 1],
    reviewChars: dashboard.guidance.reviewChars
  };
}

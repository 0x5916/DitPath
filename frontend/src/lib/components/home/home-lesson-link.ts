import * as m from '#lib/paraglide/messages.js';
import { learningRecommendationHref } from '#lib/data/learning-snapshot.ts';
import { LESSONS } from '#lib/training/sequence.ts';
import type { Recommendation } from '#lib/training/learning-policy/recommendation.ts';
import { recommendationTitle } from '#lib/components/learning/recommendation-copy.ts';
import { isRecommendationLessonLocked } from '#lib/training/v2/lesson-access.ts';

interface HomeLessonLink {
  title: string;
  hint: string;
  path: string;
}

interface HomeLessonInput {
  dashboard: {
    returning: boolean;
    unfinishedSession: { step: number } | null;
    guidance: {
      courseComplete: boolean;
      currentStep: number;
      unlockedStep: number;
      reviewChars: string[];
    };
  } | null;
  snapshot: {
    knownCharacters: string[];
    coverage: 'complete' | 'local-only' | 'partial';
    profile: { charWpm: number };
    recommendation: { primary: Recommendation };
  } | null;
  recentReview: boolean;
}

/** Pick the strongest truthful next action for the returning Home dashboard. */
export function homeLessonLink({
  dashboard,
  snapshot,
  recentReview
}: HomeLessonInput): HomeLessonLink {
  const title = m.nav_learn();
  const path = '/morse/learn';
  if (!dashboard) return { title, hint: '', path };

  const unfinished = dashboard.unfinishedSession;
  if (!unfinished && snapshot && snapshot.knownCharacters.length >= 2) {
    const primary = snapshot.recommendation.primary;
    if (!isRecommendationLessonLocked(primary, dashboard.guidance.unlockedStep)) {
      return {
        title: recommendationTitle(primary),
        hint:
          snapshot.coverage === 'partial'
            ? m.learning_coverage_partial()
            : m.learning_overview_profile({ speed: snapshot.profile.charWpm }),
        path: learningRecommendationHref(primary, snapshot.knownCharacters)
      };
    }
  }
  if (dashboard.returning && !unfinished && !recentReview)
    return {
      title: m.review_return_title(),
      hint: m.review_return_hint(),
      path: '/morse/learn/session?review=return'
    };
  if (dashboard.guidance.courseComplete && !unfinished)
    return { title, hint: m.learn_complete_title(), path };

  const { currentStep, reviewChars } = dashboard.guidance;
  const step = unfinished?.step ?? currentStep;
  const characters = (LESSONS[step - 1] ?? '').split('').join(', ');
  return {
    title: unfinished
      ? m.home_lesson_title({ step, characters })
      : m.home_start_lesson_title({ step, characters }),
    hint: unfinished
      ? m.learn_restart_title({ step })
      : reviewChars.length
        ? m.learn_review_title({ characters: reviewChars.join(', ') })
        : '',
    path: unfinished ? path : `${path}/session?step=${step}`
  };
}

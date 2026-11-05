import { describe, expect, it } from 'vitest';
import * as m from '#lib/paraglide/messages.js';
import type { Recommendation } from '#lib/training/learning-policy/recommendation.ts';
import { homeLessonLink } from './home-lesson-link';

function dashboard(
  overrides: {
    returning?: boolean;
    unfinishedStep?: number | null;
    courseComplete?: boolean;
    currentStep?: number;
    reviewChars?: string[];
  } = {}
) {
  const {
    returning = false,
    unfinishedStep = null,
    courseComplete = false,
    currentStep = 1,
    reviewChars = []
  } = overrides;
  return {
    returning,
    unfinishedSession: unfinishedStep === null ? null : { step: unfinishedStep },
    guidance: { courseComplete, currentStep, reviewChars }
  };
}

function snapshot(
  recommendation: Recommendation,
  knownCharacters = ['K', 'M', 'T'],
  coverage: 'complete' | 'local-only' | 'partial' = 'complete'
) {
  return {
    knownCharacters,
    coverage,
    profile: { charWpm: 20 },
    recommendation: { primary: recommendation }
  };
}

describe('homeLessonLink', () => {
  it('falls back to the course when no dashboard is loaded', () => {
    expect(homeLessonLink({ dashboard: null, snapshot: null, recentReview: false })).toEqual({
      title: m.nav_learn(),
      hint: '',
      path: '/morse/learn'
    });
  });

  it('offers the saved lesson for an unfinished session', () => {
    expect(
      homeLessonLink({
        dashboard: dashboard({ unfinishedStep: 3 }),
        snapshot: null,
        recentReview: false
      })
    ).toEqual({
      title: m.home_lesson_title({ step: 3, characters: 'S' }),
      hint: m.learn_restart_title({ step: 3 }),
      path: '/morse/learn'
    });
  });

  it('uses the prospective recommendation when recorded characters are known', () => {
    const link = homeLessonLink({
      dashboard: dashboard(),
      snapshot: snapshot({ reason: 'new-lesson', targets: ['M'], lesson: 2 }),
      recentReview: false
    });
    expect(link.path).toBe('/morse/learn/session?step=2');
    expect(link.title).toBe(m.learning_next_new({ step: 2, characters: 'M' }));
    expect(link.hint).toBe(m.learning_overview_profile({ speed: 20 }));
  });

  it('marks partial coverage in the hint', () => {
    const link = homeLessonLink({
      dashboard: dashboard(),
      snapshot: snapshot(
        { reason: 'new-lesson', targets: ['M'], lesson: 2 },
        ['K', 'M'],
        'partial'
      ),
      recentReview: false
    });
    expect(link.hint).toBe(m.learning_coverage_partial());
  });

  it('opens a return screening after a recorded break', () => {
    expect(
      homeLessonLink({
        dashboard: dashboard({ returning: true }),
        snapshot: null,
        recentReview: false
      }).path
    ).toBe('/morse/learn/session?review=return');
  });

  it('does not repeat the return screening after a recent review', () => {
    expect(
      homeLessonLink({
        dashboard: dashboard({ returning: true }),
        snapshot: null,
        recentReview: true
      }).path
    ).toBe('/morse/learn/session?step=1');
  });

  it('acknowledges course completion without inventing a new lesson', () => {
    expect(
      homeLessonLink({
        dashboard: dashboard({ courseComplete: true, currentStep: 39 }),
        snapshot: null,
        recentReview: false
      })
    ).toMatchObject({ hint: m.learn_complete_title(), path: '/morse/learn' });
  });

  it('names a review due in the current guidance', () => {
    expect(
      homeLessonLink({
        dashboard: dashboard({ currentStep: 4, reviewChars: ['T'] }),
        snapshot: null,
        recentReview: false
      })
    ).toMatchObject({
      title: m.home_start_lesson_title({ step: 4, characters: 'U' }),
      hint: m.learn_review_title({ characters: 'T' }),
      path: '/morse/learn/session?step=4'
    });
  });
});

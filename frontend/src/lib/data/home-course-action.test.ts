import { describe, expect, it } from 'vitest';
import { LESSONS } from '../training/sequence';
import { homeCourseAction } from './home-course-action';
import type { HomeDashboard } from './home-dashboard';

function dashboard(
  overrides: Partial<Pick<HomeDashboard, 'unfinishedSession' | 'guidance'>> = {}
): Pick<HomeDashboard, 'unfinishedSession' | 'guidance'> {
  return {
    unfinishedSession: null,
    guidance: {
      currentStep: 3,
      unlockedStep: 3,
      masteryMap: new Map(),
      reviewChars: [],
      courseComplete: false
    },
    ...overrides
  } as Pick<HomeDashboard, 'unfinishedSession' | 'guidance'>;
}

describe('home course action', () => {
  it('uses the guided current step and introduced characters', () => {
    expect(homeCourseAction(dashboard())).toEqual({
      kind: 'start',
      step: 3,
      characters: LESSONS[2],
      reviewChars: []
    });
  });

  it('keeps a due guided review visible on the guided action', () => {
    expect(
      homeCourseAction(
        dashboard({
          guidance: {
            ...dashboard().guidance,
            reviewChars: ['K', 'M']
          }
        })
      )
    ).toMatchObject({ kind: 'start', reviewChars: ['K', 'M'] });
  });

  it('offers restart for an unfinished guided session instead of a new lesson', () => {
    expect(
      homeCourseAction(
        dashboard({
          unfinishedSession: { step: 2 } as HomeDashboard['unfinishedSession']
        })
      )
    ).toEqual({ kind: 'unfinished', step: 2, characters: LESSONS[1] });
  });

  it('reports persistent course completion without inventing a recall step', () => {
    expect(
      homeCourseAction(
        dashboard({
          guidance: {
            ...dashboard().guidance,
            courseComplete: true
          }
        })
      )
    ).toEqual({ kind: 'complete' });
  });

  it('clamps an out-of-range saved step to the curriculum', () => {
    expect(
      homeCourseAction(
        dashboard({
          unfinishedSession: { step: LESSONS.length + 4 } as HomeDashboard['unfinishedSession']
        })
      )
    ).toEqual({
      kind: 'unfinished',
      step: LESSONS.length,
      characters: LESSONS.at(-1)
    });
  });
});

import { describe, expect, it } from 'vitest';
import * as m from '#lib/paraglide/messages.js';
import type { CharacterMastery } from '#lib/training/v2/types.ts';
import { DEFAULT_MASTERY_POLICY } from '#lib/training/v2/types.ts';
import { masteryRequirements } from './lesson-requirements';

function mastery(overrides: Partial<CharacterMastery> = {}): CharacterMastery {
  return {
    character: 'K',
    status: 'learning',
    totalAttempts: 0,
    correctAttempts: 0,
    rollingAccuracy: 0,
    medianLatencyMs: null,
    replayRate: 0,
    sessionCount: 0,
    lastPractisedAt: null,
    dueForReviewAt: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  };
}

describe('masteryRequirements', () => {
  it('lists every blocker with policy-derived values', () => {
    const requirements = masteryRequirements(mastery());
    expect(requirements.map((requirement) => requirement.id)).toEqual([
      'attempts',
      'sessions',
      'accuracy',
      'speed'
    ]);
    expect(requirements[0]).toMatchObject({
      label: m.learn_unlock_attempts_label(),
      current: 0,
      target: DEFAULT_MASTERY_POLICY.minAttemptsForStability
    });
    expect(requirements[2].current).toBeUndefined();
    expect(requirements[3].value).toBe(
      m.learn_unlock_speed_missing_value({
        required: (DEFAULT_MASTERY_POLICY.maxAutomaticLatencyMs / 1000).toFixed(3)
      })
    );
  });

  it('shows measured values instead of missing-value copy', () => {
    const requirements = masteryRequirements(
      mastery({
        totalAttempts: 4,
        sessionCount: 1,
        rollingAccuracy: 0.75,
        medianLatencyMs: 1800
      })
    );
    expect(requirements.find((requirement) => requirement.id === 'accuracy')).toMatchObject({
      current: 0.75,
      target: DEFAULT_MASTERY_POLICY.targetAccuracy
    });
    expect(requirements.find((requirement) => requirement.id === 'speed')?.value).toBe(
      m.learn_unlock_speed_value({ current: '1.800', required: '1.500' })
    );
  });

  it('adds the review blocker without inventing a progress target', () => {
    const requirements = masteryRequirements(
      mastery({
        status: 'review',
        totalAttempts: 20,
        sessionCount: 3,
        rollingAccuracy: 0.95,
        medianLatencyMs: 900
      })
    );
    expect(requirements).toEqual([{ id: 'review', label: m.learn_unlock_review_due(), value: '' }]);
  });

  it('returns nothing when the character is stable', () => {
    expect(
      masteryRequirements(
        mastery({
          status: 'stable',
          totalAttempts: 20,
          sessionCount: 3,
          rollingAccuracy: 0.95,
          medianLatencyMs: 900
        })
      )
    ).toEqual([]);
  });
});

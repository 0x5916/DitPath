import { describe, expect, it } from 'vitest';
import { LESSONS } from '../sequence';
import type { Recommendation } from '../learning-policy/recommendation';
import type { AttemptEvent } from './types';
import {
  deriveGuidedLessonAccess,
  isGuidedLessonUnlocked,
  isRecommendationLessonLocked
} from './lesson-access';

const NOW = '2026-11-07T00:00:00.000Z';

function attempt(targetCharacter: string, sessionId: string, index: number): AttemptEvent {
  return {
    schemaVersion: 1,
    id: `attempt-${targetCharacter}-${sessionId}-${index}`,
    sessionId,
    promptId: `prompt-${targetCharacter}-${sessionId}-${index}`,
    promptKind: 'recall',
    targetCharacter,
    enteredText: targetCharacter,
    isCorrect: true,
    classification: 'automatic',
    latencyMs: 500 + index,
    replayCount: 0,
    inputMode: 'keyboard',
    charWpm: 20,
    effWpm: 12,
    freqHz: 600,
    createdAt: new Date(Date.parse(NOW) - (100 - index) * 1000).toISOString()
  };
}

function stableLessonOne(): AttemptEvent[] {
  return ['K', 'M'].flatMap((character) =>
    ['session-a', 'session-b'].flatMap((sessionId) =>
      Array.from({ length: 6 }, (_, index) => attempt(character, sessionId, index))
    )
  );
}

describe('guided lesson access', () => {
  it('keeps an empty course at lesson 1', () => {
    const access = deriveGuidedLessonAccess([], NOW);
    expect(access).toMatchObject({ currentStep: 1, unlockedStep: 1, courseComplete: false });
    expect(isGuidedLessonUnlocked(1, access)).toBe(true);
    expect(isGuidedLessonUnlocked(2, access)).toBe(false);
  });

  it('uses the existing guided progression to unlock the next lesson', () => {
    const access = deriveGuidedLessonAccess(stableLessonOne(), NOW);
    expect(access.unlockedStep).toBe(2);
    expect(isGuidedLessonUnlocked(2, access)).toBe(true);
    expect(isGuidedLessonUnlocked(3, access)).toBe(false);
    expect(access.courseComplete).toBe(false);
  });

  it('treats every curriculum lesson as unlocked after full completion', () => {
    const attempts = LESSONS.flatMap((characters) =>
      [...characters].flatMap((character) =>
        ['session-a', 'session-b'].flatMap((sessionId) =>
          Array.from({ length: 6 }, (_, index) => attempt(character, sessionId, index))
        )
      )
    );
    const access = deriveGuidedLessonAccess(attempts, NOW);
    expect(access.courseComplete).toBe(true);
    expect(access.unlockedStep).toBe(LESSONS.length);
    expect(isGuidedLessonUnlocked(LESSONS.length, access)).toBe(true);
  });
});

describe('learning recommendation access gate', () => {
  const nextLesson: Recommendation = {
    reason: 'new-lesson',
    targets: ['R'],
    lesson: 2
  };

  it('blocks a new-lesson recommendation above the guided unlock', () => {
    expect(isRecommendationLessonLocked(nextLesson, 1)).toBe(true);
    expect(isRecommendationLessonLocked(nextLesson, 2)).toBe(false);
  });

  it('does not gate review or check recommendations', () => {
    expect(
      isRecommendationLessonLocked({ reason: 'due-check', targets: ['K'], lesson: null }, 1)
    ).toBe(false);
    expect(
      isRecommendationLessonLocked({ reason: 'repair', targets: ['K', 'M'], lesson: null }, 1)
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { deriveCourseGuidance, deriveCoursePathItemStatus } from './course-guidance';
import { DEFAULT_MASTERY_POLICY, type AttemptEvent } from './types';

const NOW = '2026-10-16T12:00:00.000Z';

function stableAttempts(characters: string, createdAt = NOW): AttemptEvent[] {
  return [...characters].flatMap((character) =>
    Array.from({ length: DEFAULT_MASTERY_POLICY.minAttemptsForStability }, (_, index) => ({
      schemaVersion: 1,
      id: `${character}-${index}`,
      sessionId: `session-${index % DEFAULT_MASTERY_POLICY.minSessionsForStability}`,
      promptId: 'prompt',
      promptKind: 'recall',
      targetCharacter: character,
      enteredText: character,
      isCorrect: true,
      classification: 'automatic',
      latencyMs: 1000,
      replayCount: 0,
      inputMode: 'keyboard',
      charWpm: 20,
      effWpm: 12,
      freqHz: 600,
      createdAt
    }))
  );
}

describe('course guidance', () => {
  it('stops at the first unstable lesson rather than scanning locked lessons', () => {
    const guidance = deriveCourseGuidance([], NOW, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(1);
    expect(guidance.unlockedStep).toBe(1);
    expect([...guidance.masteryMap.keys()]).toEqual(['K', 'M']);
    expect(guidance.courseComplete).toBe(false);
  });

  it('does not declare completion when the final lesson has only just unlocked', () => {
    const guidance = deriveCourseGuidance(stableAttempts('KMR'), NOW, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(3);
    expect(guidance.unlockedStep).toBe(3);
    expect(guidance.masteryMap.get('S')?.status).toBe('new');
    expect(guidance.courseComplete).toBe(false);
  });

  it('requires every introduced symbol to have historical stability before declaring completion', () => {
    const guidance = deriveCourseGuidance(stableAttempts('KMRS'), NOW, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(3);
    expect(guidance.unlockedStep).toBe(3);
    expect(guidance.courseComplete).toBe(true);
  });

  it.each([
    ['two hours', 2 * 3_600_000],
    ['three days', 3 * 86_400_000],
    ['several weeks', 35 * 86_400_000]
  ])('keeps previously unlocked lessons after %s of inactivity', (_, elapsed) => {
    const guidance = deriveCourseGuidance(
      stableAttempts('KMR'),
      new Date(Date.parse(NOW) + elapsed).toISOString(),
      ['KM', 'R', 'S']
    );
    expect(guidance.currentStep).toBe(3);
    expect(guidance.unlockedStep).toBe(3);
    expect(guidance.courseComplete).toBe(false);
  });

  it('reports due reviews without relocking or claiming current stability', () => {
    const later = new Date(Date.parse(NOW) + 35 * 86_400_000).toISOString();
    const guidance = deriveCourseGuidance(stableAttempts('KMR'), later, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(3);
    expect(guidance.unlockedStep).toBe(3);
    expect(guidance.reviewChars).toEqual(['K', 'M', 'R']);
    expect(guidance.masteryMap.get('K')?.status).toBe('review');
    expect(guidance.masteryMap.get('K')?.status).not.toBe('stable');
  });

  it('keeps historical unlocks separate from missing current evidence', () => {
    const guidance = deriveCourseGuidance([], NOW, ['KM'], {
      history: stableAttempts('KM')
    });
    expect(guidance.currentStep).toBe(1);
    expect(guidance.unlockedStep).toBe(1);
    expect(guidance.courseComplete).toBe(true);
    expect(guidance.masteryMap.get('K')?.status).toBe('new');
  });

  it('does not unlock a lesson without legitimate history', () => {
    const guidance = deriveCourseGuidance(stableAttempts('KMR'), NOW, ['KM', 'R', 'S']);
    expect(guidance.unlockedStep).toBe(3);
    expect(
      deriveCoursePathItemStatus(3, 'S', {
        currentStep: guidance.currentStep,
        unlockedStep: guidance.unlockedStep,
        masteryMap: guidance.masteryMap
      })
    ).toBe('current');
    expect(
      deriveCoursePathItemStatus(4, 'U', {
        currentStep: guidance.currentStep,
        unlockedStep: guidance.unlockedStep,
        masteryMap: guidance.masteryMap
      })
    ).toBe('locked');
  });

  it('keeps previously unlocked lessons interactive while review is due', () => {
    const later = new Date(Date.parse(NOW) + 35 * 86_400_000).toISOString();
    const guidance = deriveCourseGuidance(stableAttempts('KMR'), later, ['KM', 'R', 'S']);
    const input = {
      currentStep: guidance.currentStep,
      unlockedStep: guidance.unlockedStep,
      masteryMap: guidance.masteryMap
    };
    expect(deriveCoursePathItemStatus(1, 'KM', input)).toBe('review');
    expect(deriveCoursePathItemStatus(2, 'R', input)).toBe('review');
    expect(deriveCoursePathItemStatus(4, 'U', input)).toBe('locked');
  });

  it('survives a serialization reload without changing progression', () => {
    const history = stableAttempts('KMR');
    const before = deriveCourseGuidance(history, NOW, ['KM', 'R', 'S']);
    const reloaded = JSON.parse(JSON.stringify(history)) as AttemptEvent[];
    const after = deriveCourseGuidance(reloaded, NOW, ['KM', 'R', 'S']);
    expect(after.currentStep).toBe(before.currentStep);
    expect(after.unlockedStep).toBe(before.unlockedStep);
    expect(after.courseComplete).toBe(before.courseComplete);
    expect([...after.masteryMap.entries()]).toEqual([...before.masteryMap.entries()]);
  });

  it('keeps legacy suggestions visible without treating them as verified unlocks', () => {
    expect(
      deriveCoursePathItemStatus(5, 'A', {
        currentStep: 1,
        unlockedStep: 1,
        masteryMap: new Map(),
        suggestedStep: 5
      })
    ).toBe('legacy-unverified');
    expect(
      deriveCoursePathItemStatus(6, 'P', {
        currentStep: 1,
        unlockedStep: 1,
        masteryMap: new Map(),
        suggestedStep: 5
      })
    ).toBe('locked');
  });
});

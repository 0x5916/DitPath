import { describe, expect, it } from 'vitest';
import { deriveCourseGuidance } from './course-guidance';
import { DEFAULT_MASTERY_POLICY, type AttemptEvent } from './types';

const NOW = '2026-10-16T12:00:00.000Z';

function stableAttempts(characters: string): AttemptEvent[] {
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
      createdAt: NOW
    }))
  );
}

describe('course guidance', () => {
  it('stops at the first unstable lesson rather than scanning locked lessons', () => {
    const guidance = deriveCourseGuidance([], NOW, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(1);
    expect([...guidance.masteryMap.keys()]).toEqual(['K', 'M']);
    expect(guidance.courseComplete).toBe(false);
  });

  it('does not declare completion when the final lesson has only just unlocked', () => {
    const guidance = deriveCourseGuidance(stableAttempts('KMR'), NOW, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(3);
    expect(guidance.masteryMap.get('S')?.status).toBe('new');
    expect(guidance.courseComplete).toBe(false);
  });

  it('requires every introduced symbol to be stable before declaring completion', () => {
    const guidance = deriveCourseGuidance(stableAttempts('KMRS'), NOW, ['KM', 'R', 'S']);
    expect(guidance.currentStep).toBe(3);
    expect(guidance.courseComplete).toBe(true);
  });

  it('returns due review characters with a shared evaluation time', () => {
    const guidance = deriveCourseGuidance(stableAttempts('KMR'), '2026-11-01T12:00:00.000Z', [
      'KM',
      'R'
    ]);
    expect(guidance.currentStep).toBe(1);
    expect(guidance.reviewChars).toEqual(['K', 'M']);
    expect(guidance.courseComplete).toBe(false);
    expect(guidance.masteryMap.has('R')).toBe(false);
  });
});

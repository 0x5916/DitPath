import { describe, expect, it } from 'vitest';
import { LESSONS } from '../../training/sequence';
import type { SessionSummary } from '../../training/v2/types';
import { resultView } from './result-view';

const summary: SessionSummary = {
  sessionId: 'result',
  step: 1,
  totalAttempts: 13,
  scoredAttempts: 11,
  correctAttempts: 10,
  accuracy: 10 / 11,
  medianLatencyMs: 1300,
  totalReplays: 2,
  strongCharacters: [],
  weakCharacters: [],
  unlockedNextStep: false,
  progressionReasonCode: 'insufficient_sessions',
  completedAt: '2026-10-26T00:00:00.000Z'
};

describe('result presentation', () => {
  it('shows measured accuracy and response time without changing the summary', () => {
    expect(resultView(Object.freeze(summary))).toMatchObject({
      accuracyPercent: 91,
      latencySeconds: '1.3',
      action: 'repeat',
      reason: 'sessions'
    });
  });
  it('keeps no evidence distinct from measured zero accuracy', () => {
    expect(
      resultView({
        ...summary,
        scoredAttempts: 0,
        correctAttempts: 0,
        accuracy: 0,
        medianLatencyMs: null
      })
    ).toMatchObject({ accuracyPercent: null, latencySeconds: null });
    expect(
      resultView({ ...summary, correctAttempts: 0, accuracy: 0, medianLatencyMs: null })
    ).toMatchObject({ accuracyPercent: 0, latencySeconds: null });
  });
  it.each([
    ['overall_accuracy_too_low', [], 'accuracy'],
    ['weak_character_detected', ['K'], 'characters'],
    ['introduced_character_unstable', ['M'], 'characters'],
    ['insufficient_attempts', [], 'attempts'],
    ['insufficient_sessions', [], 'sessions'],
    ['weak_character_detected', [], 'continue'],
    ['unknown_reason', ['K'], 'continue']
  ])('explains %s without inventing an unlock', (progressionReasonCode, weakCharacters, reason) => {
    expect(resultView({ ...summary, progressionReasonCode, weakCharacters })).toMatchObject({
      reason,
      action: 'repeat',
      nextStep: null
    });
  });
  it('names the curriculum-derived next lesson only when the decision allows it', () => {
    expect(
      resultView({
        ...summary,
        unlockedNextStep: true,
        progressionReasonCode: 'unlocked_next_character'
      })
    ).toMatchObject({ action: 'next', reason: 'next', nextStep: 2, nextCharacters: LESSONS[1] });
    expect(
      resultView({ ...summary, progressionReasonCode: 'unlocked_next_character' }).action
    ).toBe('repeat');
    expect(resultView({ ...summary, unlockedNextStep: true }).action).toBe('repeat');
  });
  it('finishes the last lesson without offering a nonexistent next lesson', () => {
    expect(
      resultView({
        ...summary,
        step: LESSONS.length,
        progressionReasonCode: 'all_curriculum_completed'
      })
    ).toMatchObject({ reason: 'complete', action: 'finish', nextStep: null });
    expect(
      resultView({
        ...summary,
        step: LESSONS.length,
        unlockedNextStep: true,
        progressionReasonCode: 'unlocked_next_character'
      }).action
    ).toBe('repeat');
    expect(
      resultView({ ...summary, progressionReasonCode: 'all_curriculum_completed' }).action
    ).toBe('repeat');
  });
});

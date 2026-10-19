import { describe, expect, it } from 'vitest';
import { sessionOccurredAt, summarizeProgress } from './progress-summary';
import type { AttemptEvent, HistorySessionRecord, TrainingSessionRecord } from './types';

const NOW = '2026-10-16T12:00:00.000Z';

function attempt(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    schemaVersion: 1,
    id: 'attempt',
    sessionId: 'session',
    promptId: 'prompt',
    promptKind: 'recall',
    targetCharacter: 'K',
    enteredText: 'K',
    isCorrect: true,
    classification: 'automatic',
    latencyMs: 1000,
    replayCount: 0,
    inputMode: 'keyboard',
    charWpm: 20,
    effWpm: 12,
    freqHz: 600,
    createdAt: NOW,
    ...overrides
  };
}

function session(overrides: Partial<TrainingSessionRecord> = {}): TrainingSessionRecord {
  return {
    schemaVersion: 1,
    id: 'session',
    step: 1,
    charWpm: 20,
    effWpm: 12,
    freqHz: 600,
    startedAt: '2026-10-16T11:00:00.000Z',
    completedAt: '2026-10-16T11:01:30.000Z',
    status: 'completed',
    promptCount: 12,
    completedPromptCount: 12,
    ...overrides
  };
}

describe('local progress summary', () => {
  it('uses observed completion across midnight, then downloaded occurrence, without inventing an end', () => {
    const record = session({
      startedAt: '2026-10-15T23:59:00.000Z',
      completedAt: '2026-10-16T00:01:00.000Z'
    });
    expect(sessionOccurredAt(record)).toBe('2026-10-16T00:01:00.000Z');
    expect(sessionOccurredAt({ ...record, occurredAt: NOW })).toBe(NOW);
    expect(sessionOccurredAt({ ...record, completedAt: undefined })).toBe(record.startedAt);
    expect(sessionOccurredAt({ startedAt: null, completedAt: null })).toBe('');
  });

  it('distinguishes missing accuracy evidence from a measured zero', () => {
    const empty = summarizeProgress([], [], NOW);
    expect(empty).toMatchObject({
      hasRecentActivity: false,
      accuracyPercent: null,
      sessionCount: 0,
      totalMinutes: 0
    });
    expect(
      summarizeProgress([attempt({ classification: 'unmeasured' })], [], NOW).accuracyPercent
    ).toBeNull();
    expect(summarizeProgress([attempt({ isCorrect: false })], [], NOW).accuracyPercent).toBe(0);
  });

  it('calculates scored accuracy within inclusive seven-day bounds', () => {
    const result = summarizeProgress(
      [
        attempt({ createdAt: '2026-10-09T12:00:00.000Z' }),
        attempt({ isCorrect: false }),
        attempt({ createdAt: '2026-10-09T11:59:59.999Z', isCorrect: false }),
        attempt({ createdAt: '2026-10-16T12:00:00.001Z', isCorrect: false }),
        attempt({ classification: 'unmeasured', isCorrect: false })
      ],
      [],
      NOW
    );
    expect(result.accuracyPercent).toBe(50);
  });

  it('counts every recent completed session and sums recorded elapsed time without a 50-session cap', () => {
    const sessions = Array.from({ length: 75 }, (_, index) => session({ id: `session-${index}` }));
    const result = summarizeProgress(
      [attempt()],
      [
        ...sessions,
        session({ status: 'abandoned' }),
        session({ status: 'in-progress' }),
        session({ startedAt: '2026-10-08T12:00:00.000Z', completedAt: '2026-10-08T12:01:00.000Z' }),
        session({ startedAt: '2026-10-17T12:00:00.000Z', completedAt: '2026-10-17T12:01:00.000Z' })
      ],
      NOW
    );
    expect(result).toMatchObject({ sessionCount: 75, timedSessionCount: 75, totalMinutes: 112.5 });
  });

  it('reports incomplete timing evidence without inventing durations', () => {
    const missing = session({ completedAt: undefined });
    const backwards = session({ completedAt: '2026-10-16T10:59:59.000Z' });
    const future = session({ completedAt: '2026-10-17T12:00:00.000Z' });
    expect(summarizeProgress([], [missing, backwards, future], NOW)).toMatchObject({
      sessionCount: 2,
      timedSessionCount: 0,
      totalMinutes: null
    });
    expect(summarizeProgress([], [missing, session()], NOW)).toMatchObject({
      sessionCount: 2,
      timedSessionCount: 1,
      totalMinutes: 1.5
    });
  });

  it('includes practice activity without treating it as guided recognition evidence', () => {
    const practice = session({ mode: 'practice', accuracy: 1 });
    const result = summarizeProgress([], [practice], NOW);
    expect(result).toMatchObject({
      hasRecentActivity: true,
      sessionCount: 1,
      guidedSessionCount: 0,
      practiceSessionCount: 1,
      totalMinutes: 1.5,
      accuracyPercent: null
    });
    expect(result.masteryMap.get('K')?.totalAttempts).toBe(0);
    expect(
      summarizeProgress([attempt({ isCorrect: false })], [session(), practice], NOW)
    ).toMatchObject({ guidedSessionCount: 1, practiceSessionCount: 1, accuracyPercent: 0 });
  });

  it('includes legacy summaries by occurrence without inventing mode or elapsed time', () => {
    const legacy: HistorySessionRecord = {
      schemaVersion: 1,
      id: 'legacy',
      step: 1,
      mode: 'legacy',
      status: 'completed',
      occurredAt: NOW,
      startedAt: null,
      completedAt: null,
      charWpm: null,
      effWpm: null
    };
    const summary = summarizeProgress([], [legacy], NOW);
    expect(summary).toMatchObject({
      hasRecentActivity: true,
      sessionCount: 1,
      guidedSessionCount: 0,
      practiceSessionCount: 0,
      legacySessionCount: 1,
      timedSessionCount: 0,
      totalMinutes: null,
      accuracyPercent: null
    });
  });

  it('derives slow characters and mastery only from valid recent recognition evidence', () => {
    const recent = Array.from({ length: 3 }, () => attempt({ latencyMs: 2100 }));
    const result = summarizeProgress(
      [
        ...recent,
        attempt({ targetCharacter: 'M', createdAt: '2026-08-01T12:00:00.000Z' }),
        attempt({ targetCharacter: 'M', createdAt: 'invalid' }),
        attempt({ targetCharacter: 'M', createdAt: '2026-10-17T12:00:00.000Z' })
      ],
      [],
      NOW
    );
    expect(result.slowChars).toEqual(['K']);
    expect(result.masteryMap.get('K')?.totalAttempts).toBe(3);
    expect(result.masteryMap.get('M')?.status).toBe('new');
  });

  it('keeps confusion direction and latest occurrence, excluding warm-up and group errors', () => {
    const result = summarizeProgress(
      [
        attempt({ isCorrect: false, enteredText: 'M' }),
        attempt({ isCorrect: false, enteredText: 'm', createdAt: '2026-10-15T12:00:00.000Z' }),
        attempt({ isCorrect: false, targetCharacter: 'M', enteredText: 'K' }),
        attempt({ isCorrect: false, targetCharacter: 'M', enteredText: 'K' }),
        attempt({ isCorrect: false, enteredText: 'M', classification: 'unmeasured' }),
        attempt({ isCorrect: false, targetCharacter: 'KM', enteredText: 'MK' }),
        attempt({ isCorrect: false, enteredText: 'K' })
      ],
      [],
      NOW
    );
    expect(result.confusionPairs).toEqual([
      { expected: 'K', actual: 'M', confusionCount: 2, lastOccurredAt: NOW },
      { expected: 'M', actual: 'K', confusionCount: 2, lastOccurredAt: NOW }
    ]);
  });
});

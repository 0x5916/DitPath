import { LESSONS } from '../../src/lib/training/sequence';
import type { AttemptEvent, TrainingSessionRecord } from '../../src/lib/training/v2/types';

export const SCENARIOS = {
  newcomer: ['New learner / empty history', '/'],
  returning: ['Returning learner / populated history', '/'],
  interrupted: ['Interrupted lesson', '/'],
  complete: ['Course complete', '/morse/learn'],
  loading: ['Loading history (10 seconds)', '/morse/progress'],
  'save-once': ['Practice save fails once, then retry', '/morse/practice'],
  'account-error': ['Account settings unavailable', '/settings'],
  'pending-sync': ['Synthetic account / pending sync', '/settings']
} as const;
export type Scenario = keyof typeof SCENARIOS;
export const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

export function buildFixture(scenario: Scenario, now: number) {
  const characters = scenario === 'complete' ? LESSONS.join('') : 'KM';
  const populated = !['newcomer', 'save-once', 'account-error'].includes(scenario);
  const attempts: AttemptEvent[] = populated
    ? [...characters].flatMap((character) =>
        Array.from({ length: 12 }, (_, i): AttemptEvent => ({
          schemaVersion: 1,
          id: `fixture-${character}-${i}`,
          sessionId: `fixture-session-${i % 2}`,
          promptId: `fixture-${character}-${i}`,
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
          createdAt: new Date(now - ((i % 2) + 1) * 3600_000).toISOString()
        }))
      )
    : [];
  const sessions: TrainingSessionRecord[] = populated
    ? [0, 1].map((i) => ({
        schemaVersion: 1,
        id: `fixture-session-${i}`,
        mode: 'guided',
        step: scenario === 'complete' ? 39 : 1,
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        startedAt: new Date(now - (i + 1) * 3600_000 - 60_000).toISOString(),
        completedAt: new Date(now - (i + 1) * 3600_000).toISOString(),
        status: 'completed',
        promptCount: attempts.length / 2,
        completedPromptCount: attempts.length / 2
      }))
    : [];
  if (scenario === 'interrupted')
    sessions.push({
      schemaVersion: 1,
      id: 'fixture-interrupted',
      mode: 'guided',
      step: 2,
      charWpm: 20,
      effWpm: 12,
      freqHz: 600,
      startedAt: new Date(now - 60_000).toISOString(),
      status: 'in-progress',
      promptCount: 15,
      completedPromptCount: 0
    });
  return { attempts, sessions };
}

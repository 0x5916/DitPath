import { describe, expect, it } from 'vitest';
import { calculateCharacterWeights, selectNextCharacter } from './scheduler';
import type { AttemptEvent, CharacterMastery } from './types';

function createMockMastery(
  character: string,
  overrides: Partial<CharacterMastery> = {}
): CharacterMastery {
  return {
    character,
    status: 'stable',
    totalAttempts: 20,
    correctAttempts: 19,
    rollingAccuracy: 0.95,
    medianLatencyMs: 1200,
    replayRate: 0.05,
    sessionCount: 3,
    lastPractisedAt: '2026-10-04T10:00:00.000Z',
    dueForReviewAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-04T10:00:00.000Z',
    ...overrides
  };
}

describe('Adaptive Review Scheduler', () => {
  it('gives highest priority to due-review and new symbols over stable symbols', () => {
    const masteryMap = new Map<string, CharacterMastery>();
    masteryMap.set('K', createMockMastery('K', { status: 'stable' }));
    masteryMap.set('M', createMockMastery('M', { status: 'stable' }));
    masteryMap.set('R', createMockMastery('R', { status: 'review' }));
    masteryMap.set('T', createMockMastery('T', { status: 'new' }));

    const weights = calculateCharacterWeights(['K', 'M', 'R', 'T'], masteryMap, []);

    const weightT = weights.find((w) => w.character === 'T')!;
    const weightR = weights.find((w) => w.character === 'R')!;
    const weightK = weights.find((w) => w.character === 'K')!;

    expect(weightT.reasonCode).toBe('new-introduction');
    expect(weightR.reasonCode).toBe('due-review');
    expect(weightK.reasonCode).toBe('maintenance-review');

    expect(weightT.weight).toBeGreaterThan(weightK.weight);
    expect(weightR.weight).toBeGreaterThan(weightK.weight);
  });

  it('elevates priority when a symbol had a recent error', () => {
    const masteryMap = new Map<string, CharacterMastery>();
    masteryMap.set('K', createMockMastery('K', { status: 'stable' }));
    masteryMap.set('M', createMockMastery('M', { status: 'stable' }));

    const recentAttempts: AttemptEvent[] = [
      {
        schemaVersion: 1,
        id: 'att_1',
        sessionId: 'sess_1',
        promptId: 'prm_1',
        promptKind: 'recall',
        targetCharacter: 'M',
        enteredText: 'T',
        isCorrect: false, // Error on M
        classification: 'incorrect',
        latencyMs: 2000,
        replayCount: 1,
        inputMode: 'keyboard',
        charWpm: 20,
        effWpm: 12,
        freqHz: 600,
        createdAt: '2026-10-04T10:00:00.000Z'
      }
    ];

    const weights = calculateCharacterWeights(['K', 'M'], masteryMap, recentAttempts);
    const weightM = weights.find((w) => w.character === 'M')!;
    const weightK = weights.find((w) => w.character === 'K')!;

    expect(weightM.reasonCode).toBe('recent-error');
    expect(weightM.weight).toBeGreaterThan(weightK.weight);
  });

  it('penalizes immediately preceding character to prevent repetitive prompts', () => {
    const masteryMap = new Map<string, CharacterMastery>();
    masteryMap.set('T', createMockMastery('T', { status: 'new' }));
    masteryMap.set('K', createMockMastery('K', { status: 'stable' }));

    // When T was NOT the last character:
    const weightsNormal = calculateCharacterWeights(['T', 'K'], masteryMap, []);
    const weightTNormal = weightsNormal.find((w) => w.character === 'T')!.weight;

    // When T WAS the last character:
    const weightsWithPenalty = calculateCharacterWeights(['T', 'K'], masteryMap, [], [], {
      lastCharacter: 'T'
    });
    const weightTPenalized = weightsWithPenalty.find((w) => w.character === 'T')!.weight;

    expect(weightTPenalized).toBeLessThan(weightTNormal);
    expect(weightTPenalized).toBeCloseTo(weightTNormal * 0.1, 2);
  });

  it('preserves non-zero weight for all active symbols so none starve', () => {
    const masteryMap = new Map<string, CharacterMastery>();
    const chars = ['K', 'M', 'R', 'S', 'U', 'A'];
    for (const ch of chars) {
      masteryMap.set(ch, createMockMastery(ch));
    }

    const weights = calculateCharacterWeights(chars, masteryMap, []);
    for (const w of weights) {
      expect(w.weight).toBeGreaterThan(0);
    }
  });

  it('selects characters deterministically with injected random generator', () => {
    const masteryMap = new Map<string, CharacterMastery>();
    masteryMap.set('K', createMockMastery('K'));
    masteryMap.set('M', createMockMastery('M'));

    const mockRandomLow = () => 0.05;
    const selected1 = selectNextCharacter(['K', 'M'], masteryMap, [], [], {
      random: mockRandomLow
    });
    expect(selected1.character).toBe('K');

    const mockRandomHigh = () => 0.95;
    const selected2 = selectNextCharacter(['K', 'M'], masteryMap, [], [], {
      random: mockRandomHigh
    });
    expect(selected2.character).toBe('M');
  });
});

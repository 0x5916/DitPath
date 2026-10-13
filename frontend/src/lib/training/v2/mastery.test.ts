import { describe, expect, it, vi } from 'vitest';
import { getMasteryBlockers, reduceCharacterMasteries, reduceCharacterMastery } from './mastery';
import { DEFAULT_MASTERY_POLICY, type AttemptEvent } from './types';
import { LESSONS } from '../sequence';

function createMockAttempt(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    schemaVersion: 1,
    id: 'att_1',
    sessionId: 'sess_1',
    promptId: 'prm_1',
    promptKind: 'recall',
    targetCharacter: 'T',
    enteredText: 'T',
    isCorrect: true,
    classification: 'automatic',
    latencyMs: 1200,
    replayCount: 0,
    inputMode: 'keyboard',
    charWpm: 20,
    effWpm: 12,
    freqHz: 600,
    createdAt: '2026-10-04T12:00:00.000Z',
    ...overrides
  };
}

describe('Character Mastery Reducer', () => {
  it('explains why three accurate sessions can leave M short despite successful group answers', () => {
    const history = Array.from({ length: 3 }, (_, session) =>
      ['K', 'K', 'K', 'K', 'K', 'K', 'M', 'M', 'M', 'KM', 'MK'].map((character, prompt) =>
        createMockAttempt({
          id: `${session}_${prompt}`,
          sessionId: `session_${session}`,
          targetCharacter: character,
          enteredText: character,
          promptKind: character.length > 1 ? 'short-group' : 'recall'
        })
      )
    ).flat();
    const options = { nowIso: '2026-10-04T13:00:00.000Z' };
    const k = reduceCharacterMastery('K', history, options);
    const m = reduceCharacterMastery('M', history, options);
    expect(k.status).toBe('stable');
    expect(getMasteryBlockers(k)).toEqual([]);
    expect(m).toMatchObject({ totalAttempts: 9, sessionCount: 3, rollingAccuracy: 1 });
    expect(getMasteryBlockers(m)).toEqual(['attempts']);
  });

  it('returns new status when no attempts exist for the symbol', () => {
    const mastery = reduceCharacterMastery('T', []);
    expect(mastery.status).toBe('new');
    expect(mastery.totalAttempts).toBe(0);
    expect(mastery.sessionCount).toBe(0);
    expect(mastery.lastPractisedAt).toBeNull();
  });

  it('never marks a symbol stable from a single attempt', () => {
    const attempt = createMockAttempt();
    const mastery = reduceCharacterMastery('T', [attempt]);

    expect(mastery.status).toBe('learning');
    expect(getMasteryBlockers(mastery)).toContain('sessions');
    expect(mastery.totalAttempts).toBe(1);
    expect(mastery.sessionCount).toBe(1);
    expect(mastery.rollingAccuracy).toBe(1);
  });

  it('strictly enforces the multi-session stability rule (cannot be stable from 1 session)', () => {
    // 20 perfect attempts, all within sess_1
    const attempts: AttemptEvent[] = Array.from({ length: 20 }, (_, i) =>
      createMockAttempt({
        id: `att_${i}`,
        sessionId: 'sess_1',
        latencyMs: 1100,
        createdAt: new Date(1700000000000 + i * 10000).toISOString()
      })
    );

    const mastery = reduceCharacterMastery('T', attempts);
    expect(mastery.totalAttempts).toBe(20);
    expect(mastery.sessionCount).toBe(1);
    // Despite 20/20 correct and fast, single-session cannot be stable:
    expect(mastery.status).toBe('learning');
  });

  it('marks a character stable when multi-session, accuracy, count, and speed gates pass', () => {
    // 8 attempts in session 1, 8 attempts in session 2
    const attempts: AttemptEvent[] = [];
    for (let i = 0; i < 8; i++) {
      attempts.push(
        createMockAttempt({
          id: `s1_${i}`,
          sessionId: 'sess_1',
          latencyMs: 1200,
          createdAt: '2026-10-01T10:00:00.000Z'
        })
      );
    }
    for (let i = 0; i < 8; i++) {
      attempts.push(
        createMockAttempt({
          id: `s2_${i}`,
          sessionId: 'sess_2',
          latencyMs: 1250,
          createdAt: '2026-10-02T10:00:00.000Z'
        })
      );
    }

    const mastery = reduceCharacterMastery('T', attempts, {
      nowIso: '2026-10-02T12:00:00.000Z' // within 3-day review interval
    });

    expect(mastery.totalAttempts).toBe(16);
    expect(mastery.sessionCount).toBe(2);
    expect(mastery.rollingAccuracy).toBe(1);
    expect(mastery.medianLatencyMs).toBeLessThanOrEqual(1500);
    expect(mastery.status).toBe('stable');
  });

  it('transitions to review status when reviewIntervalDays expires', () => {
    // Multi-session stable set, last practiced on 2026-10-01
    const attempts: AttemptEvent[] = [
      ...Array.from({ length: 7 }, (_, i) =>
        createMockAttempt({
          id: `s1_${i}`,
          sessionId: 'sess_1',
          createdAt: '2026-10-01T10:00:00.000Z'
        })
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        createMockAttempt({
          id: `s2_${i}`,
          sessionId: 'sess_2',
          createdAt: '2026-10-02T10:00:00.000Z'
        })
      )
    ];

    // Evaluate 5 days later (> 3 days review interval)
    const mastery = reduceCharacterMastery('T', attempts, {
      nowIso: '2026-10-07T10:00:00.000Z'
    });

    expect(mastery.status).toBe('review');
    expect(getMasteryBlockers(mastery)).toEqual(['review']);
  });

  it('does not grant stability to slow-correct answers even if accuracy is 100%', () => {
    // 16 attempts across 2 sessions, all correct but slow (2800ms > 1500ms)
    const attempts: AttemptEvent[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        createMockAttempt({
          id: `s1_${i}`,
          sessionId: 'sess_1',
          latencyMs: 2800,
          classification: 'developing',
          createdAt: '2026-10-01T10:00:00.000Z'
        })
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        createMockAttempt({
          id: `s2_${i}`,
          sessionId: 'sess_2',
          latencyMs: 2900,
          classification: 'developing',
          createdAt: '2026-10-02T10:00:00.000Z'
        })
      )
    ];

    const mastery = reduceCharacterMastery('T', attempts, {
      nowIso: '2026-10-02T12:00:00.000Z'
    });

    expect(mastery.rollingAccuracy).toBe(1);
    expect(mastery.medianLatencyMs).toBe(2850);
    expect(getMasteryBlockers(mastery)).toEqual(['speed']);
    // Because medianLatency exceeds 1500ms, it remains learning:
    expect(mastery.status).toBe('learning');
  });
});

describe('Batch Character Mastery Reducer', () => {
  const nowIso = '2026-10-05T12:00:00.000Z';

  it('matches every single-reducer field for shuffled, mixed-case and equal-time histories', () => {
    const symbols = ['k', 'M', '.', '/', '?'];
    const history = Array.from({ length: 80 }, (_, i) =>
      createMockAttempt({
        id: `mixed_${i}`,
        sessionId: `session_${i % 3}`,
        targetCharacter: symbols[i % symbols.length],
        isCorrect: i % 4 !== 0,
        classification: i % 7 === 0 ? 'unmeasured' : i % 4 === 0 ? 'missing' : 'automatic',
        latencyMs: 900 + (i % 9) * 130,
        replayCount: i % 3,
        createdAt: new Date(Date.parse('2026-10-03T12:00:00.000Z') + (i % 8) * 1000).toISOString()
      })
    ).reverse();
    const characters = ['K', 'k', 'M', '.', '/', '?', 'Z', ''];
    const options = {
      nowIso,
      policy: { ...DEFAULT_MASTERY_POLICY, rollingWindowSize: 4, reviewIntervalDays: 2 }
    };
    const results = reduceCharacterMasteries(characters, history, options);
    for (const character of characters) {
      expect(results.get(character)).toEqual(reduceCharacterMastery(character, history, options));
    }
  });

  it('preserves requested case keys and collapses only exact duplicate keys', () => {
    const results = reduceCharacterMasteries(['T', 't', 'T'], [createMockAttempt()], { nowIso });
    expect([...results.keys()]).toEqual(['T', 't']);
    expect(results.get('T')?.character).toBe('T');
    expect(results.get('t')).toEqual({ ...results.get('T'), character: 't' });
  });

  it('handles missing symbols, an empty symbol and an empty request', () => {
    const history = [createMockAttempt({ classification: 'unmeasured' })];
    const results = reduceCharacterMasteries(['T', 'Z', ''], history, { nowIso });
    for (const character of results.keys()) {
      expect(results.get(character)).toEqual(reduceCharacterMastery(character, [], { nowIso }));
    }
    expect(reduceCharacterMasteries([], history, { nowIso }).size).toBe(0);
  });

  it('does not mutate frozen histories', () => {
    const history = Object.freeze([
      Object.freeze(createMockAttempt({ createdAt: '2026-10-04T12:00:00.000Z' })),
      Object.freeze(createMockAttempt({ id: 'older', createdAt: '2026-10-01T12:00:00.000Z' }))
    ]);
    const before = JSON.stringify(history);
    reduceCharacterMasteries(Object.freeze(['T', 'M']), history, { nowIso });
    expect(JSON.stringify(history)).toBe(before);
  });

  it('resolves one default snapshot time even when the clock advances', () => {
    const clock = vi
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValueOnce(nowIso)
      .mockReturnValue('2026-10-05T12:00:00.001Z');
    try {
      const results = reduceCharacterMasteries(['T', 'M'], []);
      expect(clock).toHaveBeenCalledTimes(1);
      expect(results.get('T')?.updatedAt).toBe(nowIso);
      expect(results.get('M')?.updatedAt).toBe(nowIso);
    } finally {
      clock.mockRestore();
    }
  });

  it('reads history targets at most twice instead of once per curriculum character', () => {
    const characters = LESSONS.join('').split('');
    let reads = 0;
    const history = Array.from({ length: 400 }, (_, i) => {
      const character = characters[i % characters.length];
      return {
        ...createMockAttempt({ id: `counted_${i}` }),
        get targetCharacter() {
          reads++;
          return character;
        }
      };
    });
    reduceCharacterMasteries([...characters, 'k', 'K'], history, { nowIso });
    expect(reads).toBeLessThanOrEqual(history.length * 2);
    reads = 0;
    for (const character of characters) reduceCharacterMastery(character, history, { nowIso });
    expect(reads).toBe(history.length * characters.length);
  });
});

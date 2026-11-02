import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildReviewPlan,
  parseReviewRequest,
  recordedCharacters,
  returningLearner,
  reviewHref,
  summarizeReview
} from './targeted-review';
import type { AttemptEvent, HistorySessionRecord } from './v2/types';
const settings = { charWpm: 20, effWpm: 12, freqHz: 600 };
const request = { purpose: 'coaching' as const, targets: ['K', 'R'] };
const make = (known: string[]) => {
  let id = 0;
  return buildReviewPlan(
    request,
    known,
    settings,
    () => 0.3,
    () => `p${++id}`
  );
};
describe('targeted coaching plan', () => {
  it('balances six pair prompts with six known anchors and never assesses', () => {
    const plan = make(['K', 'M', 'R', 'S']);
    expect(plan.prompts).toHaveLength(12);
    expect(plan.prompts.filter((p) => ['K', 'R'].includes(p.spec.expectedText))).toHaveLength(6);
    expect(new Set(plan.prompts.map((p) => p.id)).size).toBe(12);
    expect(
      plan.prompts.every(
        (p, i) => !p.isScored && p.ordinal === i + 1 && p.spec.options === undefined
      )
    ).toBe(true);
  });
  it('uses only the pair when other recorded characters are unavailable', () => {
    const p = make(['K', 'R']).prompts;
    expect(p.filter((p) => p.spec.expectedText === 'K')).toHaveLength(6);
    expect(p.filter((p) => p.spec.expectedText === 'R')).toHaveLength(6);
  });
  it('rejects unknown, repeated or untaught target requests', () => {
    for (const value of [null, '', 'K', 'KK', 'K!', 'KRS'])
      expect(parseReviewRequest(value)).toBeNull();
    expect(() => make(['K', 'M'])).toThrow();
    expect(parseReviewRequest('kr')).toEqual(request);
    expect(parseReviewRequest('/?')?.targets).toEqual(['/', '?']);
    expect(reviewHref(['/', '?'])).toContain('%2F%3F');
  });
  it('does not mutate caller input or accept invalid audio settings', () => {
    const known = ['K', 'M', 'R'];
    make(known);
    expect(known).toEqual(['K', 'M', 'R']);
    expect(() => buildReviewPlan(request, known, { ...settings, effWpm: 30 })).toThrow();
  });
  it('screens eight prompts across up to eight attained characters, no unexplored letters', () => {
    for (const targets of [
      ['K'],
      ['K', 'M'],
      ['K', 'M', 'R'],
      ['K', 'M', 'R', 'S', 'U', 'A', 'P', 'T', 'L']
    ]) {
      const known = [...targets];
      const plan = buildReviewPlan(
        { purpose: 'return-screening', targets: targets.slice(0, 8) },
        known,
        settings
      );
      expect(plan.prompts).toHaveLength(8);
      expect(plan.prompts.every((p) => known.includes(p.spec.expectedText) && !p.isScored)).toBe(
        true
      );
      expect(new Set(plan.prompts.map((p) => p.spec.expectedText)).size).toBe(
        Math.min(8, targets.length)
      );
    }
    expect(() =>
      buildReviewPlan({ purpose: 'return-screening', targets: [] }, ['K'], settings)
    ).toThrow('Screening targets');
  });
  it('samples only supplied attained screening targets and cycles fewer than eight', () => {
    const known = ['K', 'M', 'R', 'S', 'U', 'A'];
    for (const targets of [['K'], ['K', 'R'], ['K', 'R', 'S', 'U', 'A', 'M']]) {
      const plan = buildReviewPlan({ purpose: 'return-screening', targets }, known, settings);
      expect(plan.prompts).toHaveLength(8);
      expect(new Set(plan.prompts.map((p) => p.spec.expectedText))).toEqual(new Set(targets));
      expect(plan.targets).toEqual(targets);
    }
    expect(() =>
      buildReviewPlan({ purpose: 'return-screening', targets: ['K', 'Z'] }, known, settings)
    ).toThrow();
    expect(() =>
      buildReviewPlan({ purpose: 'return-screening', targets: ['K', 'K'] }, known, settings)
    ).toThrow();
  });
  it('parses and validates explicit screening targets without bypassing the curriculum', () => {
    expect(parseReviewRequest('return')).toEqual({
      purpose: 'return-screening',
      targets: []
    });
    expect(parseReviewRequest('return', 'KR')).toEqual({
      purpose: 'return-screening',
      targets: ['K', 'R']
    });
    for (const value of ['', 'KK', 'K!', 'KRSMUAPTLX'])
      expect(parseReviewRequest('return', value)).toBeNull();
  });
  it('keeps replay assistance visible without making correctness disappear', () => {
    const attempts = [
      { isCorrect: true, replayCount: 0 },
      { isCorrect: true, replayCount: 1 },
      { isCorrect: false, replayCount: 0 }
    ] as AttemptEvent[];
    expect(summarizeReview(attempts)).toEqual({
      answered: 3,
      firstListen: 1,
      afterReplay: 1,
      notCorrect: 1
    });
  });
});
describe('return invitation', () => {
  const now = '2026-10-27T00:00:00.000Z';
  const history = [
    { status: 'completed', completedAt: '2026-10-13T00:00:00.000Z' }
  ] as HistorySessionRecord[];
  it('uses lifetime recorded exposure, not current stability or seven-day activity', () => {
    expect(recordedCharacters([{ targetCharacter: 'KMR!' }] as AttemptEvent[])).toEqual([
      'K',
      'M',
      'R'
    ]);
    expect(returningLearner(history, ['K'], now)).toBe(true);
    expect(returningLearner(history, [], now)).toBe(false);
  });
  it('does not repeat the absence invitation after a local review', () => {
    expect(returningLearner(history, ['K'], now, '2026-10-26T00:00:00.000Z')).toBe(false);
  });
  it('ignores future/invalid dates and untouched in-progress sessions', () => {
    expect(
      returningLearner(
        [{ status: 'completed', completedAt: 'bad' }] as HistorySessionRecord[],
        ['K'],
        now
      )
    ).toBe(false);
    expect(
      returningLearner(
        [{ status: 'completed', completedAt: '2030-01-01T00:00:00Z' }] as HistorySessionRecord[],
        ['K'],
        now
      )
    ).toBe(false);
    expect(
      returningLearner(
        [{ status: 'in-progress', startedAt: '2020-01-01T00:00:00Z' }] as HistorySessionRecord[],
        ['K'],
        now
      )
    ).toBe(false);
  });
});

describe('shared return-screening contract', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../../testdata/return-screening-v1.json', import.meta.url), 'utf8')
  ) as {
    policyVersion: string;
    cases: {
      id: string;
      introducedCharacters: string[];
      attainedCharacters: string[];
      targets: string[];
      expectedPrompts: number;
      expectedDistinct: number;
    }[];
  };
  for (const vector of fixture.cases)
    it(vector.id, () => {
      const plan = buildReviewPlan(
        { purpose: 'return-screening', targets: vector.targets },
        vector.introducedCharacters,
        settings
      );
      expect(fixture.policyVersion).toBe('learning-policy-1.0');
      expect(plan.prompts).toHaveLength(vector.expectedPrompts);
      expect(plan.targets).toEqual(vector.targets);
      expect(new Set(plan.prompts.map((prompt) => prompt.spec.expectedText))).toEqual(
        new Set(vector.targets)
      );
      expect(new Set(plan.prompts.map((prompt) => prompt.spec.expectedText)).size).toBe(
        vector.expectedDistinct
      );
      expect(vector.targets.every((ch) => vector.attainedCharacters.includes(ch))).toBe(true);
    });
});

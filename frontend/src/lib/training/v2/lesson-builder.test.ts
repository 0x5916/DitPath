import { describe, expect, it } from 'vitest';
import { buildLessonPlan } from './lesson-builder';
import { getLessonChars } from '../sequence';

/** Simple deterministic PRNG for unit tests (LCG). */
function createSeededRandom(seed = 123456789): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('Deterministic Lesson Builder', () => {
  it('generates identical plans with identical seeded random sources', () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(42);

    const plan1 = buildLessonPlan(7, { random: rng1 });
    const plan2 = buildLessonPlan(7, { random: rng2 });

    expect(plan1.length).toBe(plan2.length);
    for (let i = 0; i < plan1.length; i++) {
      expect(plan1[i].spec.expectedText).toBe(plan2[i].spec.expectedText);
      expect(plan1[i].spec.kind).toBe(plan2[i].spec.kind);
      expect(plan1[i].isScored).toBe(plan2[i].isScored);
    }
  });

  it('restricts all prompt characters strictly to the active cumulative Koch set', () => {
    const rng = createSeededRandom(99);

    // Step 1: KM
    const planStep1 = buildLessonPlan(1, { random: rng });
    const validStep1 = new Set(['K', 'M']);
    for (const p of planStep1) {
      for (const ch of p.spec.characters) {
        expect(validStep1.has(ch)).toBe(true);
      }
    }

    // Step 7: K M R S U A P T
    const activeStep7Chars = new Set(getLessonChars(7).split(''));
    const planStep7 = buildLessonPlan(7, { random: rng });

    for (const p of planStep7) {
      for (const ch of p.spec.characters) {
        expect(activeStep7Chars.has(ch)).toBe(true);
      }
      if (p.spec.options) {
        for (const opt of p.spec.options) {
          expect(activeStep7Chars.has(opt)).toBe(true);
        }
      }
    }

    // Characters from future steps (e.g. 'L' is step 8) must NEVER appear in step 7
    expect(activeStep7Chars.has('L')).toBe(false);
    for (const p of planStep7) {
      expect(p.spec.characters.includes('L')).toBe(false);
    }
  });

  it('always introduces and tests the newest introduced symbol', () => {
    const rng = createSeededRandom(777);
    const plan = buildLessonPlan(7, { random: rng }); // Step 7 introduces 'T'

    // Introduction prompt must be present for 'T'
    const intros = plan.filter((p) => p.spec.kind === 'introduction');
    expect(intros.length).toBeGreaterThanOrEqual(1);
    expect(intros[0].spec.expectedText).toBe('T');
    expect(intros[0].isScored).toBe(false);

    // Recall prompt must test 'T'
    const recallT = plan.filter((p) => p.spec.kind === 'recall' && p.spec.expectedText === 'T');
    expect(recallT.length).toBeGreaterThan(0);
  });

  it('preserves sequential 1-based ordinals across the plan', () => {
    const plan = buildLessonPlan(3);
    for (let i = 0; i < plan.length; i++) {
      expect(plan[i].ordinal).toBe(i + 1);
    }
  });

  it('marks introductions and unscored matches as unscored, and recall/contrast as scored', () => {
    const plan = buildLessonPlan(4);

    for (const p of plan) {
      if (p.spec.kind === 'introduction' || p.spec.kind === 'unscored-match') {
        expect(p.isScored).toBe(false);
      } else {
        expect(p.isScored).toBe(true);
      }
    }
  });

  it('respects custom prompt counts in configuration', () => {
    const customConfig = {
      introductionCount: 2,
      unscoredMatchCount: 1,
      scoredRecallCount: 4,
      contrastCount: 2,
      shortGroupCount: 0,
      exitCheckCount: 1
    };

    const plan = buildLessonPlan(2, customConfig);
    const kinds = plan.map((p) => p.spec.kind);

    expect(kinds.filter((k) => k === 'introduction').length).toBe(2);
    expect(kinds.filter((k) => k === 'unscored-match').length).toBe(1);
    expect(kinds.filter((k) => k === 'recall').length).toBe(4 + 1); // scoredRecallCount + exitCheck
    expect(kinds.filter((k) => k === 'contrast').length).toBe(2);
    expect(kinds.filter((k) => k === 'short-group').length).toBe(0);
  });
});

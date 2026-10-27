import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateCheck } from './assessment';
import { projectCharacterEvidence } from './evidence';
import { reconcileReview, type ReviewState } from './review';
import type { Attainment, CheckPlan, EvidenceContext, Observation } from './types';

interface Vector {
  id: string;
  kind: 'evidence' | 'review';
  checks: { plan: CheckPlan; observations: Observation[]; completedAt: string | null }[];
  context: EvidenceContext;
  persisted: Attainment[];
  initial: ReviewState;
  nowIso: string;
  expected: unknown;
}
const fixtures = JSON.parse(
  readFileSync(new URL('../../../../testdata/learning-policy-v1.json', import.meta.url), 'utf8')
) as { cases: Vector[] };
describe('shared TypeScript / Go learning-policy vectors', () => {
  for (const vector of fixtures.cases)
    it(vector.id, () => {
      const evaluated = vector.checks.map((check) =>
        evaluateCheck(check.plan, check.observations, check.completedAt)
      );
      const result =
        vector.kind === 'evidence'
          ? {
              evaluated,
              projection: projectCharacterEvidence(evaluated, vector.persisted, vector.context)
            }
          : reconcileReview(vector.initial, evaluated, vector.nowIso);
      expect(JSON.parse(JSON.stringify(result))).toEqual(vector.expected);
    });
});

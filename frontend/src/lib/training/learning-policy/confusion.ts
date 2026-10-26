import { MORSE } from '../sequence';
import { canonicalChecks } from './evidence';
import { LEARNING_POLICY as P, timestamp } from './policy';
import type { EvaluatedCheck, EvidenceContext, TargetTrial } from './types';

export interface ConfusionFinding {
  readonly expected: string;
  readonly actual: string;
  readonly confusionCount: number;
  readonly opportunityCount: number;
  readonly rate: number;
  readonly checkIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

/** Diagnostics use unassisted first opportunities, unlike the proficiency denominator. */
export function detectConfusions(
  checks: readonly EvaluatedCheck[],
  context: Omit<EvidenceContext, 'character'>
): readonly ConfusionFinding[] {
  const now = timestamp(context.nowIso);
  if (!Number.isFinite(now)) throw new RangeError('A valid diagnostic time is required');
  if (context.coverage === 'partial') return [];
  const { checks: unique, conflicts } = canonicalChecks(
    checks.filter(
      (check) =>
        check.ownerKey === context.ownerKey &&
        check.profileKey === context.profileKey &&
        check.policyVersion === P.version
    )
  );
  if (conflicts.length) return [];
  const recent = unique
    .filter(
      (check) =>
        check.complete &&
        check.completedAt !== null &&
        timestamp(check.completedAt) <= now &&
        now - timestamp(check.completedAt) <= P.freshnessMs
    )
    .sort(
      (a, b) => timestamp(a.completedAt!) - timestamp(b.completedAt!) || (a.id < b.id ? -1 : 1)
    );
  const byCharacter = new Map<string, { checkId: string; trial: TargetTrial }[]>();
  for (const check of recent)
    for (const [character, result] of Object.entries(check.targets)) {
      if (character.length !== 1 || !MORSE[character]) continue;
      const bucket = byCharacter.get(character) ?? [];
      for (const trial of result.trials)
        if (trial.outcome.eligible && trial.outcome.unassistedAttempt)
          bucket.push({ checkId: check.id, trial });
      byCharacter.set(character, bucket.slice(-P.diagnosticWindowSize));
    }
  const findings: ConfusionFinding[] = [];
  for (const [expected, opportunities] of byCharacter) {
    if (opportunities.length < P.minConfusionOpportunities) continue;
    const errors = new Map<string, typeof opportunities>();
    for (const opportunity of opportunities) {
      const { trial } = opportunity,
        actual = trial.enteredText;
      if (
        trial.outcome.kind !== 'incorrect' ||
        actual === null ||
        actual.length !== 1 ||
        !MORSE[actual] ||
        actual === expected
      )
        continue;
      const bucket = errors.get(actual) ?? [];
      bucket.push(opportunity);
      errors.set(actual, bucket);
    }
    for (const [actual, wrong] of errors) {
      const checkIds = [...new Set(wrong.map((entry) => entry.checkId))].sort();
      if (
        wrong.length < P.minConfusionCount ||
        checkIds.length < P.minConfusionChecks ||
        wrong.length * P.confusionRateDenominator < opportunities.length
      )
        continue;
      findings.push({
        expected,
        actual,
        confusionCount: wrong.length,
        opportunityCount: opportunities.length,
        rate: wrong.length / opportunities.length,
        checkIds,
        evidenceIds: wrong.map((entry) => entry.trial.observationId).sort()
      });
    }
  }
  return findings.sort(
    (a, b) =>
      b.confusionCount - a.confusionCount ||
      b.rate - a.rate ||
      (a.expected < b.expected
        ? -1
        : a.expected > b.expected
          ? 1
          : a.actual < b.actual
            ? -1
            : a.actual > b.actual
              ? 1
              : 0)
  );
}

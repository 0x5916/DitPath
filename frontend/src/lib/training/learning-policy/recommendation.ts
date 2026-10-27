import { LESSONS } from '../sequence';
import type { CharacterEvidence } from './evidence';
import { LEARNING_POLICY as P, timestamp } from './policy';
import type { ReviewReadiness } from './review';
import type { EvaluatedCheck } from './types';

export type RecommendationReason =
  | 'recover-save'
  | 'recover-session'
  | 'load-history'
  | 'calibrate'
  | 'return-screening'
  | 'repair'
  | 'rest-or-adjust'
  | 'due-check'
  | 'new-lesson'
  | 'contextual-practice'
  | 'check-current';
export interface Recommendation {
  readonly reason: RecommendationReason;
  readonly targets: readonly string[];
  readonly lesson: number | null;
}
export interface RecommendationInput {
  readonly ownerKey: string;
  readonly profileKey: string;
  readonly nowIso: string;
  readonly coverage: 'complete' | 'local-only' | 'partial';
  readonly pendingSave: boolean;
  readonly interruptedSession: boolean;
  readonly completedDueCheck: boolean;
  readonly repairRoundsSinceImprovement: number;
  readonly characters: readonly {
    readonly character: string;
    readonly evidence: CharacterEvidence;
    readonly readiness: ReviewReadiness | null;
    /** Latest valid compatible assessed response, including screening. */
    readonly lastAssessedAt: string | null;
  }[];
  readonly latestWholeCheck: EvaluatedCheck | null;
}

/** Caller supplies owner-scoped validated projections, not legacy mastery labels. */
export function recommendNext(input: RecommendationInput): {
  primary: Recommendation;
  alternatives: readonly Recommendation[];
  policyVersion: string;
  evidenceIds: readonly string[];
} {
  const now = timestamp(input.nowIso);
  if (!Number.isFinite(now)) throw new RangeError('A valid recommendation time is required');
  const order = LESSONS.join('');
  const rank = (character: string) => order.indexOf(character);
  const characters = [...input.characters]
    .filter(
      (item) =>
        rank(item.character) >= 0 &&
        item.evidence.ownerKey === input.ownerKey &&
        item.evidence.profileKey === input.profileKey &&
        item.evidence.character === item.character &&
        item.evidence.policyVersion === P.version
    )
    .sort((a, b) => rank(a.character) - rank(b.character));
  const awarded = (item: (typeof characters)[number]) =>
    [...item.evidence.historical, ...item.evidence.candidates].some(
      (award) =>
        award.ownerKey === input.ownerKey &&
        award.profileKey === input.profileKey &&
        award.character === item.character &&
        award.policyVersion === P.version &&
        award.kind === 'proficiency' &&
        award.status !== 'unverified' &&
        award.status !== 'superseded' &&
        !item.evidence.revalidation.some(
          (correction) =>
            correction.reason === 'invalid-witness' &&
            (correction.claimId
              ? correction.claimId === award.claimId
              : correction.awardKey === award.key &&
                JSON.stringify(correction.checkIds) === JSON.stringify(award.checkIds))
        )
    );
  const attained = characters.filter(awarded);
  const attainedChars = new Set(attained.map((item) => item.character));
  const evidenceIds = [
    ...new Set(
      characters.flatMap((item) =>
        item.evidence.current.checkId ? [item.evidence.current.checkId] : []
      )
    )
  ].sort();
  const recommendation = (
    reason: RecommendationReason,
    targets: readonly string[] = [],
    lesson: number | null = null
  ): Recommendation => ({ reason, targets, lesson });
  const finish = (primary: Recommendation, alternatives: readonly Recommendation[] = []) => ({
    primary,
    alternatives,
    policyVersion: P.version,
    evidenceIds
  });
  if (input.pendingSave) return finish(recommendation('recover-save'));
  if (input.interruptedSession) return finish(recommendation('recover-session'));
  if (input.coverage === 'partial') return finish(recommendation('load-history'));
  const latestResponse = Math.max(
    ...characters
      .map((item) => (item.lastAssessedAt ? timestamp(item.lastAssessedAt) : -Infinity))
      .filter((time) => Number.isFinite(time) && time <= now),
    -Infinity
  );
  if (latestResponse === -Infinity)
    return finish(
      recommendation(
        'calibrate',
        attained.length
          ? attained.slice(0, P.screeningPrompts).map((item) => item.character)
          : LESSONS[0].split('')
      )
    );
  if (attained.length && now - latestResponse > P.freshnessMs) {
    const targets = [...attained]
      .sort(
        (a, b) =>
          (a.lastAssessedAt ? timestamp(a.lastAssessedAt) : -Infinity) -
            (b.lastAssessedAt ? timestamp(b.lastAssessedAt) : -Infinity) ||
          rank(a.character) - rank(b.character)
      )
      .slice(0, P.screeningPrompts)
      .map((item) => item.character);
    return finish(recommendation('return-screening', targets));
  }
  const difficult = characters.filter((item) => item.evidence.repeatedDifficulty);
  if (difficult.length)
    return finish(
      recommendation(
        input.repairRoundsSinceImprovement >= 2 ? 'rest-or-adjust' : 'repair',
        difficult.slice(0, P.maxTargets).map((item) => item.character)
      )
    );
  let attainedSteps = 0;
  for (const lesson of LESSONS) {
    if (![...lesson].every((character) => attainedChars.has(character))) break;
    attainedSteps++;
  }
  const whole = input.latestWholeCheck;
  const wholeGate =
    whole !== null &&
    whole.complete &&
    whole.ownerKey === input.ownerKey &&
    whole.profileKey === input.profileKey &&
    whole.policyVersion === P.version &&
    whole.completedAt !== null &&
    timestamp(whole.completedAt) <= now &&
    now - timestamp(whole.completedAt) <= P.freshnessMs &&
    whole.whole.eligible > 0 &&
    whole.whole.unassistedCorrect * 10 >= whole.whole.eligible * 9;
  const next =
    wholeGate && attainedSteps > 0 && attainedSteps < LESSONS.length
      ? recommendation('new-lesson', [...LESSONS[attainedSteps]], attainedSteps + 1)
      : null;
  const contextual =
    attained.length >= 4
      ? recommendation(
          'contextual-practice',
          attained.map((item) => item.character)
        )
      : null;
  const due = characters
    .filter(
      (item) =>
        item.readiness?.ready &&
        item.readiness.ownerKey === input.ownerKey &&
        item.readiness.profileKey === input.profileKey &&
        item.readiness.character === item.character &&
        item.readiness.actionableAt !== null
    )
    .sort(
      (a, b) =>
        timestamp(a.readiness!.actionableAt!) - timestamp(b.readiness!.actionableAt!) ||
        (a.lastAssessedAt ? timestamp(a.lastAssessedAt) : -Infinity) -
          (b.lastAssessedAt ? timestamp(b.lastAssessedAt) : -Infinity) ||
        rank(a.character) - rank(b.character)
    );
  if (due.length)
    return finish(
      recommendation(
        'due-check',
        due.slice(0, P.maxTargets).map((item) => item.character)
      ),
      input.completedDueCheck
        ? [next ?? contextual].filter((item): item is Recommendation => item !== null)
        : []
    );
  if (next) return finish(next);
  if (contextual) return finish(contextual);
  return finish(
    recommendation(
      'check-current',
      (characters.some((item) => item.evidence.current.criterion !== 'met' || !awarded(item))
        ? characters.filter((item) => item.evidence.current.criterion !== 'met' || !awarded(item))
        : characters
      )
        .slice(0, P.maxTargets)
        .map((item) => item.character)
    )
  );
}

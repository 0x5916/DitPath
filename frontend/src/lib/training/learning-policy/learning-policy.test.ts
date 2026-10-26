import { describe, expect, it } from 'vitest';
import { evaluateCheck, profileKey } from './assessment';
import { detectConfusions } from './confusion';
import { projectCharacterEvidence } from './evidence';
import { LEARNING_POLICY as P } from './policy';
import { initializeReview, reconcileReview, reviewReadiness } from './review';
import { recommendNext, type RecommendationInput } from './recommendation';
import type { Attainment, CheckPlan, GoalProfile, Observation } from './types';

const ownerKey = 'account:learner-a';
const profile: GoalProfile = {
  id: 'clean-20',
  task: 'single-character',
  charWpm: 20,
  audioCondition: 'clean',
  responseSupport: 'open'
};
const scope = profileKey(profile);
const now = '2026-10-26T12:00:00.000Z';
const add = (date: string, ms: number) => new Date(Date.parse(date) + ms).toISOString();
const day = 86_400_000;
function fixture(
  id: string,
  completedAt = now,
  options: {
    k?: number;
    m?: number;
    gap?: number;
    firstWrong?: boolean;
    anchors?: boolean;
    cycle?: string;
  } = {}
) {
  const startedAt = add(completedAt, -60_000);
  const characters = Array.from({ length: 10 }, () => ['K', 'M'])
    .flat()
    .concat(options.anchors ? ['R', 'S', 'R', 'S'] : []);
  const plan: CheckPlan = {
    purpose: 'mixed-check',
    id,
    ownerKey,
    policyVersion: P.version,
    profile,
    startedAt,
    targets: ['K', 'M'],
    introducedCharacters: options.anchors ? ['K', 'M', 'R', 'S'] : ['K', 'M'],
    freshOrder: true,
    feedback: 'after-check',
    prompts: characters.map((character, index) => ({
      id: `p${index}`,
      character,
      role: character === 'K' || character === 'M' ? 'target' : 'anchor'
    })),
    reviewCycleIds: options.cycle ? { K: options.cycle } : {}
  };
  const observations: Observation[] = plan.prompts.map((prompt, index) => {
    const n = Math.floor(index / 2);
    const correct =
      prompt.character === 'K'
        ? options.firstWrong
          ? n !== 0
          : n < (options.k ?? 10)
        : prompt.character === 'M'
          ? n < (options.m ?? 10)
          : true;
    const firstAt = add(startedAt, index * 1000);
    const firstTargetAt = add(startedAt, prompt.character === 'M' ? 1000 : 0);
    const previous = add(firstTargetAt, -(options.gap ?? 24 * 3_600_000));
    return {
      id: `${id}-a${index}`,
      ownerKey,
      checkId: id,
      promptId: prompt.id,
      presentationId: `${id}-sound${index}`,
      firstResponse: correct ? prompt.character : prompt.character === 'K' ? 'M' : 'K',
      finalResponse: correct ? prompt.character : 'X',
      skipped: false,
      replayCountBeforeResponse: 0,
      helpBeforeResponse: false,
      audioValid: true,
      interruptionInvalidated: false,
      responseInterface: 'keyboard',
      firstPresentedAt: { source: 'monotonic-anchored', earliest: firstAt, latest: firstAt },
      priorExposure: { source: 'wall-clock-bounded', earliest: previous, latest: previous }
    };
  });
  return { plan, observations, completedAt, check: evaluateCheck(plan, observations, completedAt) };
}
function award(
  kind: Attainment['kind'] = 'proficiency',
  awardedAt = add(now, -2 * day)
): Attainment {
  return {
    key: `K-${kind}`,
    ownerKey,
    profileKey: scope,
    policyVersion: P.version,
    character: 'K',
    kind,
    awardedAt,
    checkIds: ['older-a', 'older-b'],
    status: 'verified'
  };
}
const context = (nowIso = now) => ({
  ownerKey,
  profileKey: scope,
  character: 'K',
  nowIso,
  coverage: 'complete' as const
});

describe('prospective mixed-check evidence', () => {
  it('freezes policy constants independently of legacy schemas', () => {
    expect(P.version).toBe('learning-policy-1.0');
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(P.reviewIntervalsMs)).toBe(true);
  });
  it('derives correctness and retains supported answers in the denominator', () => {
    const f = fixture('assisted');
    const observations = f.observations.map((observation, index) =>
      index === 0 || index === 2 ? { ...observation, replayCountBeforeResponse: 1 } : observation
    );
    const result = evaluateCheck(f.plan, observations, f.completedAt);
    expect(result.complete).toBe(true);
    expect(result.targets.K).toMatchObject({
      eligible: 10,
      unassistedCorrect: 8,
      finalCorrect: 10
    });
  });
  it('keeps a corrected first mistake and an explicit skip as non-successes', () => {
    const f = fixture('correction');
    const observations = f.observations.map((observation, index) =>
      index === 0
        ? { ...observation, firstResponse: 'M', finalResponse: 'K' }
        : index === 2
          ? { ...observation, firstResponse: null, finalResponse: null, skipped: true }
          : observation
    );
    expect(evaluateCheck(f.plan, observations, f.completedAt).targets.K).toMatchObject({
      eligible: 10,
      unassistedCorrect: 8,
      finalCorrect: 9
    });
  });
  it.each(['audio', 'interrupted', 'unknown', 'unattempted', 'restricted'] as const)(
    'cannot complete a check with %s opportunity',
    (kind) => {
      const f = fixture(kind);
      const bad = {
        ...f.observations[0],
        ...(kind === 'audio'
          ? { audioValid: false }
          : kind === 'interrupted'
            ? { interruptionInvalidated: true }
            : kind === 'unknown'
              ? { helpBeforeResponse: null }
              : kind === 'restricted'
                ? { responseInterface: 'restricted' as const }
                : { firstResponse: null })
      };
      const result = evaluateCheck(f.plan, [bad, ...f.observations.slice(1)], f.completedAt);
      expect(result.complete).toBe(false);
      expect(result.targets.K.eligible).toBe(9);
    }
  );
  it('deduplicates identical delivery and rejects a changed immutable observation', () => {
    const f = fixture('dedup');
    expect(
      evaluateCheck(f.plan, [...f.observations, f.observations[0]], f.completedAt).complete
    ).toBe(true);
    expect(
      evaluateCheck(
        f.plan,
        [...f.observations, { ...f.observations[0], firstResponse: 'X' }],
        f.completedAt
      ).issues
    ).toContain('conflicting-observation');
  });
  it('rejects duplicate presentation under a different event ID', () => {
    const f = fixture('duplicate');
    expect(
      evaluateCheck(
        f.plan,
        [...f.observations, { ...f.observations[0], id: 'another-id' }],
        f.completedAt
      ).complete
    ).toBe(false);
  });
  it.each(['owner', 'policy', 'feedback', 'order', 'mix', 'profile'] as const)(
    'rejects unsupported %s context',
    (kind) => {
      const f = fixture(kind);
      const plan = {
        ...f.plan,
        ...(kind === 'owner'
          ? { ownerKey: 'account:other' }
          : kind === 'policy'
            ? { policyVersion: 'legacy' }
            : kind === 'feedback'
              ? { feedback: 'immediate' as never }
              : kind === 'order'
                ? { freshOrder: false }
                : kind === 'mix'
                  ? { introducedCharacters: ['K', 'M', 'R', 'S'] }
                  : { profile: { ...profile, charWpm: 0 } })
      };
      expect(evaluateCheck(plan, f.observations, f.completedAt).complete).toBe(false);
    }
  );
  it('requires anchor coverage and derives the whole-check denominator', () => {
    const result = fixture('anchors', now, { anchors: true, k: 9, m: 9 }).check;
    expect(result.complete).toBe(true);
    expect(result.whole).toMatchObject({ eligible: 24, unassistedCorrect: 22 });
  });
});

describe('orthogonal attainment and current evidence', () => {
  it.each([
    [9, 9, true],
    [8, 10, false],
    [10, 8, false]
  ])('checks %i/10 and %i/10 award=%s', (first, second, expected) => {
    const result = projectCharacterEvidence(
      [fixture('a', add(now, -day), { k: first }).check, fixture('b', now, { k: second }).check],
      [],
      context()
    );
    expect(result.candidates.some((candidate) => candidate.kind === 'proficiency')).toBe(expected);
  });
  it.each([
    [14 * day, true],
    [14 * day + 1, false]
  ])('uses inclusive 14-day qualification boundary %i', (age, expected) => {
    const result = projectCharacterEvidence(
      [fixture('a', add(now, -age)).check, fixture('b').check],
      [],
      context()
    );
    expect(result.candidates.some((candidate) => candidate.kind === 'proficiency')).toBe(expected);
  });
  it('does not turn a single or partial block into proficiency', () => {
    const f = fixture('partial');
    const partial = evaluateCheck(f.plan, f.observations.slice(0, 18), f.completedAt);
    expect(
      projectCharacterEvidence([fixture('a', add(now, -day)).check, partial], [], context())
        .candidates
    ).toHaveLength(0);
  });
  it('does not pool incompatible profiles or owners', () => {
    const a = fixture('a', add(now, -day)).check;
    const b = fixture('b').check;
    expect(
      projectCharacterEvidence([a, { ...b, ownerKey: 'account:other' }], [], context()).candidates
    ).toHaveLength(0);
    expect(
      projectCharacterEvidence([a, { ...b, profileKey: 'different-speed' }], [], context())
        .candidates
    ).toHaveLength(0);
  });
  it('preserves historical awards while current evidence becomes stale', () => {
    const historic = award();
    const result = projectCharacterEvidence(
      [fixture('old', add(now, -45 * day)).check],
      [historic],
      context()
    );
    expect(result.current).toMatchObject({ freshness: 'stale', criterion: 'insufficient' });
    expect(result.historical).toEqual([historic]);
  });
  it('reconstructs a past qualifying decision without refreshing current evidence', () => {
    const result = projectCharacterEvidence(
      [fixture('a', add(now, -46 * day)).check, fixture('b', add(now, -45 * day)).check],
      [],
      context()
    );
    expect(result.current.freshness).toBe('stale');
    expect(result.candidates[0].awardedAt).toBe(add(now, -45 * day));
  });
  it('cannot certify while bootstrap or immutable history is uncertain', () => {
    const a = fixture('a', add(now, -day)).check,
      b = fixture('b').check;
    expect(
      projectCharacterEvidence([a, b], [], { ...context(), coverage: 'partial' }).candidates
    ).toHaveLength(0);
    const conflict = projectCharacterEvidence(
      [a, b, { ...b, evidenceIds: ['different'] }],
      [],
      context()
    );
    expect(conflict.current.freshness).toBe('incomplete');
    expect(conflict.candidates).toHaveLength(0);
  });
  it.each([
    [2, 1, true],
    [3, 0, false]
  ])('repeated difficulty from failures %i + %i is %s', (a, b, expected) => {
    expect(
      projectCharacterEvidence(
        [fixture('a', add(now, -day), { k: 10 - a }).check, fixture('b', now, { k: 10 - b }).check],
        [],
        context()
      ).repeatedDifficulty
    ).toBe(expected);
  });
  it.each([
    [20 * 3_600_000, 7 * day, true],
    [20 * 3_600_000 - 1, 7 * day, false],
    [20 * 3_600_000, 7 * day - 1, false]
  ])('retention uses conservative gap=%i and original span=%i', (gap, span, expected) => {
    const proficiency = award('proficiency', add(now, -8 * day));
    const early = fixture('early', add(proficiency.awardedAt, day + 60_000)).check;
    const later = fixture('later', add(proficiency.awardedAt, span + 60_000), { gap }).check;
    const result = projectCharacterEvidence([later, early], [proficiency], context());
    expect(result.candidates.some((candidate) => candidate.kind === 'retention')).toBe(expected);
  });
  it('a wrong cold probe followed by 9/10 is not retention', () => {
    const proficiency = award('proficiency', add(now, -8 * day));
    const checks = [
      fixture('early', add(now, -6 * day)).check,
      fixture('later', now, { firstWrong: true }).check
    ];
    expect(projectCharacterEvidence(checks, [proficiency], context()).candidates).toHaveLength(0);
  });
  it('is delivery-order independent and does not mutate frozen inputs', () => {
    const a = Object.freeze(fixture('a', add(now, -day)).check),
      b = Object.freeze(fixture('b').check);
    const input = Object.freeze([a, b]);
    expect(projectCharacterEvidence(input, [], context())).toEqual(
      projectCharacterEvidence([b, a, a], [], context())
    );
  });
});

describe('review timing and recommendation', () => {
  const origin = initializeReview(award());
  it('advances only one rung on a late due pass and consumes its cycle once', () => {
    const check = fixture('late', now, { cycle: origin.cycleId }).check;
    const result = reconcileReview(origin, [check, check], now).state;
    expect(result.rung).toBe(1);
    expect(result.dueAt).toBe(add(now, 3 * day));
    expect(reconcileReview(result, [check], now).state).toEqual(result);
  });
  it('does not advance an obsolete due cycle or skip rungs', () => {
    const first = fixture('one', add(now, -day), { cycle: origin.cycleId }).check;
    const later = fixture('two', now, { cycle: origin.cycleId }).check;
    expect(reconcileReview(origin, [later, first], now).state.rung).toBe(1);
  });
  it('resets a due cold miss despite 9/10 overall', () => {
    const check = fixture('miss', now, { firstWrong: true, cycle: origin.cycleId }).check;
    const result = reconcileReview({ ...origin, rung: 3 }, [check], now).state;
    expect(result.rung).toBe(0);
    expect(result.dueAt).toBe(add(now, day));
  });
  it('does not postpone the due time on early success or early failure', () => {
    const future = { ...origin, rung: 2, dueAt: add(now, 3 * day) };
    expect(reconcileReview(future, [fixture('pass').check], now).state.dueAt).toBe(future.dueAt);
    expect(reconcileReview(future, [fixture('fail', now, { k: 8 }).check], now).state.dueAt).toBe(
      add(now, day)
    );
    const nearer = { ...future, dueAt: add(now, 3_600_000) };
    expect(reconcileReview(nearer, [fixture('fail', now, { k: 8 }).check], now).state.dueAt).toBe(
      nearer.dueAt
    );
  });
  it('withholds credit for overlapping checks or unknown clock bounds', () => {
    const a = fixture('a', now, { cycle: origin.cycleId }).check;
    const b = fixture('b', now, { cycle: origin.cycleId }).check;
    expect(reconcileReview(origin, [a, b], now).state.rung).toBe(0);
    const unknown = {
      ...a,
      targets: {
        ...a.targets,
        K: { ...a.targets.K, firstProbe: { ...a.targets.K.firstProbe!, presentedAt: null } }
      }
    };
    expect(reconcileReview(origin, [unknown], now).state).toEqual(origin);
  });
  it('keeps readiness per character and does not trust another owner exposure', () => {
    const old = add(now, -24 * 3_600_000),
      recent = add(now, -3_600_000);
    expect(
      reviewReadiness(
        origin,
        {
          ownerKey,
          character: 'K',
          bounds: { source: 'wall-clock-bounded', earliest: old, latest: old }
        },
        now
      ).ready
    ).toBe(true);
    expect(
      reviewReadiness(
        origin,
        {
          ownerKey,
          character: 'K',
          bounds: { source: 'wall-clock-bounded', earliest: recent, latest: recent }
        },
        now
      ).reason
    ).toBe('waiting-for-gap');
    expect(
      reviewReadiness(
        origin,
        {
          ownerKey: 'other',
          character: 'K',
          bounds: { source: 'wall-clock-bounded', earliest: old, latest: old }
        },
        now
      ).reason
    ).toBe('waiting-for-evidence');
  });
  function recommendationInput(
    whole = fixture('whole', now, { anchors: true, k: 9, m: 9 }).check
  ): RecommendationInput {
    return {
      ownerKey,
      profileKey: scope,
      nowIso: now,
      coverage: 'complete',
      pendingSave: false,
      interruptedSession: false,
      completedDueCheck: false,
      repairRoundsSinceImprovement: 0,
      latestWholeCheck: whole,
      characters: ['K', 'M'].map((character) => ({
        character,
        evidence: projectCharacterEvidence([whole], [{ ...award(), character, key: character }], {
          ...context(),
          character
        }),
        readiness: null,
        lastAssessedAt: now
      }))
    };
  }
  it('prioritizes save/session recovery and incomplete coverage', () => {
    const input = recommendationInput();
    expect(recommendNext({ ...input, pendingSave: true }).primary.reason).toBe('recover-save');
    expect(recommendNext({ ...input, interruptedSession: true }).primary.reason).toBe(
      'recover-session'
    );
    expect(recommendNext({ ...input, coverage: 'partial' }).primary.reason).toBe('load-history');
  });
  it('uses exact whole-check accuracy and preserves unlocked milestones', () => {
    expect(recommendNext(recommendationInput()).primary).toMatchObject({
      reason: 'new-lesson',
      targets: ['R'],
      lesson: 2
    });
    const input = recommendationInput(fixture('weak', now, { anchors: true, k: 8, m: 9 }).check);
    expect(recommendNext(input).primary.reason).toBe('check-current');
    expect(input.characters.every((item) => item.evidence.historical.length === 1)).toBe(true);
  });
  it('screens an absent learner without erasing awards or scheduling untested symbols', () => {
    const input = recommendationInput();
    expect(
      recommendNext({
        ...input,
        characters: input.characters.map((item) => ({
          ...item,
          lastAssessedAt: add(now, -45 * day)
        }))
      }).primary
    ).toMatchObject({ reason: 'return-screening', targets: ['K', 'M'] });
  });
  it('keeps a new-lesson alternative after completing one due check', () => {
    const input = recommendationInput();
    const exposure = add(now, -day);
    const readiness = reviewReadiness(
      origin,
      {
        ownerKey,
        character: 'K',
        bounds: { source: 'wall-clock-bounded', earliest: exposure, latest: exposure }
      },
      now
    );
    const result = recommendNext({
      ...input,
      completedDueCheck: true,
      characters: input.characters.map((item) =>
        item.character === 'K' ? { ...item, readiness } : item
      )
    });
    expect(result.primary.reason).toBe('due-check');
    expect(result.alternatives[0].reason).toBe('new-lesson');
  });
});

describe('admissibility, delayed provenance and scoped diagnostics', () => {
  it.each(['missing-purpose', 'coaching-purpose'])('does not certify %s', (kind) => {
    const f = fixture(kind);
    const plan = {
      ...f.plan,
      purpose: (kind === 'missing-purpose' ? undefined : 'coaching') as never
    };
    expect(evaluateCheck(plan, f.observations, f.completedAt).complete).toBe(false);
  });
  it.each([
    'helpBeforeResponse',
    'responseInterface',
    'skipped',
    'firstResponse',
    'finalResponse'
  ] as const)('rejects omitted %s metadata', (field) => {
    const f = fixture(field);
    const observation = { ...f.observations[0], [field]: undefined } as unknown as Observation;
    const result = evaluateCheck(f.plan, [observation, ...f.observations.slice(1)], f.completedAt);
    expect(result.complete).toBe(false);
    expect(result.targets.K.unassistedCorrect).toBe(9);
  });
  it('rejects recorded playback order that contradicts the frozen plan', () => {
    const f = fixture('order');
    const observations = f.observations.map((item, index) =>
      index === 0
        ? { ...item, firstPresentedAt: f.observations[2].firstPresentedAt }
        : index === 2
          ? { ...item, firstPresentedAt: f.observations[0].firstPresentedAt }
          : item
    );
    expect(evaluateCheck(f.plan, observations, f.completedAt).issues).toContain(
      'conflicting-presentation-order'
    );
  });
  it('cannot use overlapping checks as two delayed observations', () => {
    const proficiency = award('proficiency', add(now, -8 * day));
    const a = fixture('same-a').check,
      b = fixture('same-b').check;
    expect(projectCharacterEvidence([a, b], [proficiency], context()).candidates).toHaveLength(0);
  });
  it('a later recorded exposure defeats a falsely old pre-check snapshot', () => {
    const proficiency = award('proficiency', add(now, -8 * day));
    const early = fixture('early', add(now, -6 * day)).check;
    const rehearsal = fixture('rehearsal', add(now, -3_600_000));
    const recentExposure = evaluateCheck(rehearsal.plan, rehearsal.observations.slice(0, 2), null);
    const later = fixture('later').check;
    expect(
      projectCharacterEvidence([early, recentExposure, later], [proficiency], context()).candidates
    ).toHaveLength(0);
  });
  it('reports invalid award witnesses without editing the historical claim', () => {
    const proficiency = award('proficiency', add(now, -8 * day));
    const a = fixture('same-a').check,
      b = fixture('same-b').check;
    const retention = { ...award('retention', now), checkIds: [a.id, b.id] };
    const result = projectCharacterEvidence([a, b], [proficiency, retention], context());
    expect(result.revalidation).toContainEqual({
      awardKey: retention.key,
      reason: 'invalid-witness',
      checkIds: [a.id, b.id]
    });
    expect(retention.status).toBe('verified');
    expect(result.historical).toContain(retention);
  });
  it('does not silently replace an explicitly unverified milestone', () => {
    const a = fixture('a', add(now, -day)).check,
      b = fixture('b').check;
    const result = projectCharacterEvidence(
      [a, b],
      [{ ...award(), status: 'unverified' }],
      context()
    );
    expect(result.candidates).toHaveLength(0);
  });
  it.each([
    [8, 8, 4],
    [8, 9, 0],
    [6, 10, 0]
  ])('directional errors from %i/10 and %i/10 yield count %i', (a, b, count) => {
    const findings = detectConfusions(
      [fixture('a', add(now, -day), { k: a }).check, fixture('b', now, { k: b }).check],
      context()
    );
    expect(
      findings.find((finding) => finding.expected === 'K' && finding.actual === 'M')
        ?.confusionCount ?? 0
    ).toBe(count);
    if (count) expect(findings[0]).toMatchObject({ opportunityCount: 20, rate: 0.2 });
  });
  it('assisted errors and blank skips cannot create a confusion pair', () => {
    const checks = ['a', 'b'].map((id, checkIndex) => {
      const f = fixture(id, add(now, -checkIndex * day), { k: 7 });
      const observations = f.observations.map((item, index) =>
        index === 14
          ? { ...item, firstResponse: null, finalResponse: null, skipped: true }
          : index >= 16 && index % 2 === 0
            ? { ...item, helpBeforeResponse: true }
            : item
      );
      return evaluateCheck(f.plan, observations, f.completedAt);
    });
    expect(detectConfusions(checks, context())).toEqual([]);
  });
  it('uses only the most recent 40 compatible target opportunities', () => {
    const checks = Array.from(
      { length: 6 },
      (_, index) =>
        fixture(String(index), add(now, -(5 - index) * day), { k: index < 2 ? 0 : 10 }).check
    );
    expect(detectConfusions(checks, context())).toEqual([]);
    const wrongOwner = checks.map((check) => ({ ...check, ownerKey: 'account:other' }));
    expect(detectConfusions(wrongOwner, context())).toEqual([]);
  });
});

it('requires clock provenance instead of manufacturing an exact retention gap', () => {
  const f = fixture('clock-provenance');
  const observations = f.observations.map((observation, index) =>
    index === 0
      ? {
          ...observation,
          firstPresentedAt: {
            earliest: observation.firstPresentedAt!.earliest,
            latest: observation.firstPresentedAt!.latest
          } as never
        }
      : observation
  );
  expect(evaluateCheck(f.plan, observations, f.completedAt).complete).toBe(false);
});

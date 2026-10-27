import { coldGapMs, validBounds } from './assessment';
import { canonical, LEARNING_POLICY as P, timestamp } from './policy';
import type { Attainment, EvaluatedCheck, EvidenceContext } from './types';

export interface CharacterEvidence {
  readonly ownerKey: string;
  readonly profileKey: string;
  readonly character: string;
  readonly policyVersion: string;
  readonly current: {
    readonly freshness: 'none' | 'recent' | 'stale' | 'incomplete';
    readonly criterion: 'met' | 'not-met' | 'insufficient';
    readonly checkId: string | null;
  };
  readonly historical: readonly Attainment[];
  readonly candidates: readonly Attainment[];
  readonly revalidation: readonly {
    readonly awardKey: string;
    readonly claimId?: string;
    readonly reason: 'invalid-witness' | 'earlier-attainment-found';
    readonly replacementBasisKey?: string;
    readonly checkIds: readonly string[];
  }[];
  readonly repeatedDifficulty: boolean;
  readonly issues: readonly string[];
}
export function matchesScope(check: EvaluatedCheck, context: EvidenceContext): boolean {
  return (
    check.ownerKey === context.ownerKey &&
    check.profileKey === context.profileKey &&
    check.policyVersion === P.version &&
    context.character in check.targets
  );
}
export function passesTarget(check: EvaluatedCheck, character: string): boolean {
  const result = check.targets[character];
  return (
    check.complete &&
    result?.eligible === P.opportunitiesPerTarget &&
    result.unassistedCorrect >= P.successesPerCheck
  );
}
export function coldPass(check: EvaluatedCheck, character: string): boolean {
  const probe = check.targets[character]?.firstProbe;
  return (
    passesTarget(check, character) &&
    probe?.outcome.unassistedCorrect === true &&
    (coldGapMs(probe) ?? -1) >= P.coldGapMs
  );
}

/** A snapshot cannot conceal a later known presentation of the same character. */
export function recordedColdGapMs(
  check: EvaluatedCheck,
  character: string,
  knownChecks: readonly EvaluatedCheck[]
): number | null {
  const probe = check.targets[character]?.firstProbe;
  let gap = coldGapMs(probe ?? null);
  if (gap === null || !probe) return null;
  const first = timestamp(probe.presentedAt!.earliest);
  const latestFirst = timestamp(probe.presentedAt!.latest);
  for (const other of knownChecks) {
    if (other.id === check.id || other.ownerKey !== check.ownerKey) continue;
    const otherProbe = other.targets[character]?.firstProbe;
    if (
      !otherProbe ||
      !validBounds(otherProbe.presentedAt) ||
      timestamp(otherProbe.presentedAt.earliest) > latestFirst
    )
      continue;
    // Completion is a conservative exposure upper bound for a known prior block.
    const upper = Math.max(
      timestamp(otherProbe.presentedAt.latest),
      other.completedAt ? timestamp(other.completedAt) : -Infinity
    );
    gap = Math.min(gap, first - upper);
  }
  return gap >= 0 ? gap : null;
}
export function recordedColdPass(
  check: EvaluatedCheck,
  character: string,
  knownChecks: readonly EvaluatedCheck[]
): boolean {
  return (
    coldPass(check, character) &&
    (recordedColdGapMs(check, character, knownChecks) ?? -1) >= P.coldGapMs
  );
}

/** Reject conflicting IDs rather than selecting whichever download arrived first. */
export function canonicalChecks(checks: readonly EvaluatedCheck[]): {
  checks: EvaluatedCheck[];
  conflicts: string[];
} {
  const unique = new Map<string, EvaluatedCheck>();
  const conflicts = new Set<string>();
  for (const check of checks) {
    const key = canonical([check.ownerKey, check.id]);
    const previous = unique.get(key);
    if (previous && canonical(previous) !== canonical(check)) conflicts.add(key);
    else unique.set(key, check);
  }
  return {
    checks: [...unique.entries()].filter(([key]) => !conflicts.has(key)).map(([, check]) => check),
    conflicts: [...conflicts].sort()
  };
}
const chronological = (a: EvaluatedCheck, b: EvaluatedCheck) =>
  timestamp(a.completedAt!) - timestamp(b.completedAt!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Historical criteria are replayed at each completion, never erased by today's window. */
export function projectCharacterEvidence(
  checks: readonly EvaluatedCheck[],
  persisted: readonly Attainment[],
  context: EvidenceContext
): CharacterEvidence {
  const now = timestamp(context.nowIso);
  if (!Number.isFinite(now)) throw new RangeError('A valid evaluation time is required');
  const { checks: unique, conflicts } = canonicalChecks(
    checks.filter((check) => matchesScope(check, context))
  );
  const eligible = unique
    .filter(
      (check) => check.complete && check.completedAt !== null && timestamp(check.completedAt) <= now
    )
    .sort(chronological);
  const latest = eligible.at(-1);
  const fresh = latest !== undefined && now - timestamp(latest.completedAt!) <= P.freshnessMs;
  const uncertain = context.coverage === 'partial' || conflicts.length > 0;
  const current: CharacterEvidence['current'] = {
    freshness: uncertain
      ? 'incomplete'
      : latest
        ? fresh
          ? 'recent'
          : 'stale'
        : unique.some((check) => !check.complete)
          ? 'incomplete'
          : 'none',
    criterion:
      uncertain || !fresh || !latest
        ? 'insufficient'
        : passesTarget(latest, context.character)
          ? 'met'
          : 'not-met',
    checkId: latest?.id ?? null
  };
  const historical = persisted.filter(
    (award) =>
      award.ownerKey === context.ownerKey &&
      award.profileKey === context.profileKey &&
      award.character === context.character
  );
  const candidates: Attainment[] = [];
  const knownExposureChecks = canonicalChecks(
    checks.filter(
      (check) => check.ownerKey === context.ownerKey && context.character in check.targets
    )
  ).checks;
  const revalidation: CharacterEvidence['revalidation'][number][] = [];
  const knownById = new Map(unique.map((check) => [check.id, check]));
  const scopeKey = (kind: Attainment['kind']) =>
    canonical([context.ownerKey, context.profileKey, context.character, kind, P.version]);
  const basisKey = (kind: Attainment['kind'], ids: readonly string[]) =>
    canonical([scopeKey(kind), ...ids]);
  const awardFor = (kind: Attainment['kind'], witness: readonly EvaluatedCheck[]): Attainment => ({
    key: scopeKey(kind),
    basisKey: basisKey(
      kind,
      witness.map((check) => check.id)
    ),
    ownerKey: context.ownerKey,
    profileKey: context.profileKey,
    character: context.character,
    policyVersion: P.version,
    kind,
    awardedAt: witness.at(-1)!.completedAt!,
    checkIds: witness.map((check) => check.id),
    status: 'provisional'
  });
  const currentPolicyHistory = historical.filter((award) => award.policyVersion === P.version);
  for (const award of currentPolicyHistory) {
    const witness = award.checkIds.map((id) => knownById.get(id));
    if (witness.length !== 2 || witness.some((check) => !check)) continue;
    const pair = (witness as EvaluatedCheck[]).sort(chronological);
    let valid =
      pair[0].id !== pair[1].id &&
      pair.every((check) => passesTarget(check, context.character)) &&
      timestamp(pair[1].completedAt!) <= timestamp(award.awardedAt);
    if (award.kind === 'proficiency')
      valid &&=
        timestamp(pair[1].completedAt!) - timestamp(pair[0].completedAt!) <= P.freshnessMs &&
        eligible.indexOf(pair[1]) === eligible.indexOf(pair[0]) + 1;
    else
      valid &&= pair.every((check) =>
        recordedColdPass(check, context.character, knownExposureChecks)
      );
    if (!valid)
      revalidation.push({
        awardKey: award.key,
        ...(award.claimId ? { claimId: award.claimId } : {}),
        reason: 'invalid-witness',
        checkIds: [...award.checkIds]
      });
  }
  const invalid = (award: Attainment) =>
    award.status === 'unverified' ||
    revalidation.some(
      (item) =>
        item.reason === 'invalid-witness' &&
        (item.claimId
          ? item.claimId === award.claimId
          : item.awardKey === award.key && canonical(item.checkIds) === canonical(award.checkIds))
    );
  const validHistory = currentPolicyHistory.filter(
    (award) => !invalid(award) && timestamp(award.awardedAt) <= now
  );
  const rejectedBases = new Set(
    currentPolicyHistory
      .filter(invalid)
      .map((award) => award.basisKey ?? basisKey(award.kind, award.checkIds))
  );
  const earliest = (kind: Attainment['kind']) =>
    validHistory
      .filter((award) => award.kind === kind && !invalid(award))
      .sort(
        (a, b) =>
          timestamp(a.awardedAt) - timestamp(b.awardedAt) ||
          canonical(a.checkIds).localeCompare(canonical(b.checkIds))
      )[0];
  function select(
    kind: Attainment['kind'],
    witness: readonly EvaluatedCheck[] | undefined
  ): Attainment | undefined {
    const previous = earliest(kind);
    if (!witness || uncertain) return previous;
    const candidate = awardFor(kind, witness);
    if (previous && timestamp(previous.awardedAt) <= timestamp(candidate.awardedAt))
      return previous;
    candidates.push(candidate);
    for (const award of validHistory.filter(
      (item) =>
        item.kind === kind &&
        !invalid(item) &&
        item.status !== 'superseded' &&
        timestamp(item.awardedAt) > timestamp(candidate.awardedAt)
    )) {
      revalidation.push({
        awardKey: award.key,
        ...(award.claimId ? { claimId: award.claimId } : {}),
        reason: 'earlier-attainment-found',
        checkIds: [...award.checkIds],
        replacementBasisKey: candidate.basisKey
      });
    }
    return candidate;
  }
  let proficiencyWitness: EvaluatedCheck[] | undefined;
  if (!uncertain)
    for (let index = 1; index < eligible.length; index++) {
      const pair = [eligible[index - 1], eligible[index]];
      if (
        timestamp(pair[1].completedAt!) - timestamp(pair[0].completedAt!) <= P.freshnessMs &&
        pair.every((check) => passesTarget(check, context.character)) &&
        !rejectedBases.has(
          basisKey(
            'proficiency',
            pair.map((check) => check.id)
          )
        )
      ) {
        proficiencyWitness = pair;
        break;
      }
    }
  const proficiency = select('proficiency', proficiencyWitness);
  if (proficiency) {
    const anchor = timestamp(proficiency.awardedAt);
    const later = eligible.filter(
      (check) =>
        recordedColdPass(check, context.character, knownExposureChecks) &&
        timestamp(check.targets[context.character].firstProbe!.presentedAt!.earliest) > anchor
    );
    let retentionWitness: EvaluatedCheck[] | undefined;
    for (let index = 1; index < later.length && !retentionWitness; index++) {
      if (
        timestamp(later[index].targets[context.character].firstProbe!.presentedAt!.earliest) -
          anchor <
        P.retentionSpanMs
      )
        continue;
      for (let earlier = 0; earlier < index; earlier++) {
        const pair = [later[earlier], later[index]];
        if (
          !rejectedBases.has(
            basisKey(
              'retention',
              pair.map((check) => check.id)
            )
          )
        ) {
          retentionWitness = pair;
          break;
        }
      }
    }
    for (const award of validHistory.filter((item) => item.kind === 'retention')) {
      const pair = award.checkIds.map((id) => knownById.get(id));
      if (
        pair.length === 2 &&
        pair.every(Boolean) &&
        (!pair.every(
          (check) =>
            timestamp(check!.targets[context.character].firstProbe?.presentedAt?.earliest ?? '') >
            anchor
        ) ||
          timestamp(pair[1]!.targets[context.character].firstProbe?.presentedAt?.earliest ?? '') -
            anchor <
            P.retentionSpanMs)
      ) {
        revalidation.push({
          awardKey: award.key,
          ...(award.claimId ? { claimId: award.claimId } : {}),
          reason: 'invalid-witness',
          checkIds: [...award.checkIds]
        });
        rejectedBases.add(award.basisKey ?? basisKey(award.kind, award.checkIds));
      }
    }
    select('retention', retentionWitness);
  }
  const recent = eligible
    .filter((check) => now - timestamp(check.completedAt!) <= P.freshnessMs)
    .slice(-2);
  const failures = recent.map(
    (check) =>
      check.targets[context.character].eligible - check.targets[context.character].unassistedCorrect
  );
  return {
    ownerKey: context.ownerKey,
    profileKey: context.profileKey,
    character: context.character,
    policyVersion: P.version,
    current,
    historical,
    candidates,
    revalidation,
    repeatedDifficulty:
      !uncertain &&
      failures.length === 2 &&
      failures.every((count) => count >= 1) &&
      failures[0] + failures[1] >= 3,
    issues: conflicts.map((key) => `conflicting-check:${key}`)
  };
}

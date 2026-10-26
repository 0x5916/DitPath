import { validBounds } from './assessment';
import { canonicalChecks, passesTarget, recordedColdGapMs, recordedColdPass } from './evidence';
import { canonical, LEARNING_POLICY as P, timestamp } from './policy';
import type { Attainment, EvaluatedCheck, TimeBounds } from './types';

export interface ReviewState {
  readonly ownerKey: string;
  readonly profileKey: string;
  readonly character: string;
  readonly policyVersion: string;
  readonly rung: number;
  readonly dueAt: string;
  readonly cycleId: string;
  readonly appliedCheckIds: readonly string[];
}
export interface ReviewReadiness {
  readonly ownerKey: string;
  readonly profileKey: string;
  readonly character: string;
  readonly dueAt: string;
  readonly coldEligibleAt: string | null;
  readonly actionableAt: string | null;
  readonly ready: boolean;
  readonly reason: 'upcoming' | 'due' | 'waiting-for-gap' | 'waiting-for-evidence';
}
const at = (ms: number) => new Date(ms).toISOString();
export function initializeReview(proficiency: Attainment): ReviewState {
  if (
    proficiency.kind !== 'proficiency' ||
    proficiency.status === 'unverified' ||
    proficiency.policyVersion !== P.version ||
    !Number.isFinite(timestamp(proficiency.awardedAt))
  )
    throw new RangeError('A valid current-policy proficiency award is required');
  return {
    ownerKey: proficiency.ownerKey,
    profileKey: proficiency.profileKey,
    character: proficiency.character,
    policyVersion: P.version,
    rung: 0,
    dueAt: at(timestamp(proficiency.awardedAt) + P.reviewIntervalsMs[0]),
    cycleId: canonical([proficiency.key, 'initial-review']),
    appliedCheckIds: []
  };
}

/** Rebuild from the original review state and all known checks after late downloads. */
export function reconcileReview(
  initial: ReviewState,
  input: readonly EvaluatedCheck[],
  nowIso: string
): { state: ReviewState; issues: readonly string[] } {
  const now = timestamp(nowIso);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(timestamp(initial.dueAt)) ||
    !Number.isInteger(initial.rung) ||
    initial.rung < 0 ||
    initial.rung >= P.reviewIntervalsMs.length ||
    initial.policyVersion !== P.version
  )
    throw new RangeError('Invalid review state or clock');
  let state = { ...initial, appliedCheckIds: [...initial.appliedCheckIds] };
  const { checks, conflicts } = canonicalChecks(
    input.filter(
      (check) =>
        check.ownerKey === initial.ownerKey &&
        check.profileKey === initial.profileKey &&
        check.policyVersion === P.version &&
        initial.character in check.targets
    )
  );
  const issues = conflicts.map((id) => `conflicting-check:${id}`);
  const ordered = checks
    .filter(
      (check) => check.complete && check.completedAt !== null && timestamp(check.completedAt) <= now
    )
    .sort((a, b) => timestamp(a.startedAt) - timestamp(b.startedAt) || (a.id < b.id ? -1 : 1));
  const overlapping = new Set<string>();
  for (let a = 0; a < ordered.length; a++)
    for (let b = a + 1; b < ordered.length; b++) {
      if (timestamp(ordered[b].startedAt) < timestamp(ordered[a].completedAt!)) {
        overlapping.add(ordered[a].id);
        overlapping.add(ordered[b].id);
      }
    }
  for (const check of ordered) {
    if (state.appliedCheckIds.includes(check.id)) continue;
    if (overlapping.has(check.id)) {
      issues.push(`ambiguous-check-order:${check.id}`);
      continue;
    }
    const target = check.targets[state.character];
    const probe = target.firstProbe;
    if (!probe || !validBounds(probe.presentedAt)) {
      issues.push(`unknown-check-time:${check.id}`);
      continue;
    }
    const earliest = timestamp(probe.presentedAt.earliest);
    const latest = timestamp(probe.presentedAt.latest);
    const due = timestamp(state.dueAt);
    if (earliest < due && latest >= due) {
      issues.push(`uncertain-due-boundary:${check.id}`);
      continue;
    }
    state = { ...state, appliedCheckIds: [...state.appliedCheckIds, check.id] };
    const recovery = timestamp(check.completedAt!) + P.reviewIntervalsMs[0];
    if (latest < due) {
      if (!passesTarget(check, state.character))
        state = { ...state, rung: 0, dueAt: at(Math.min(due, recovery)) };
      continue;
    }
    // An obsolete cycle cannot earn a second positive interval transition.
    const sameCycle = check.reviewCycleIds[state.character] === state.cycleId;
    const cold = (recordedColdGapMs(check, state.character, checks) ?? -1) >= P.coldGapMs;
    const failed =
      !passesTarget(check, state.character) || (cold && !probe.outcome.unassistedCorrect);
    if (failed) {
      state = {
        ...state,
        rung: 0,
        dueAt: at(recovery),
        cycleId: canonical([state.cycleId, check.id, 'recovery'])
      };
    } else if (
      sameCycle &&
      cold &&
      probe.outcome.unassistedCorrect &&
      recordedColdPass(check, state.character, checks)
    ) {
      const rung = Math.min(state.rung + 1, P.reviewIntervalsMs.length - 1);
      state = {
        ...state,
        rung,
        dueAt: at(timestamp(check.completedAt!) + P.reviewIntervalsMs[rung]),
        cycleId: canonical([state.cycleId, check.id, 'passed'])
      };
    }
  }
  return { state, issues };
}

export function reviewReadiness(
  state: ReviewState,
  exposure: {
    readonly ownerKey: string;
    readonly character: string;
    readonly bounds: TimeBounds | null;
  },
  nowIso: string
): ReviewReadiness {
  const now = timestamp(nowIso),
    due = timestamp(state.dueAt);
  if (!Number.isFinite(now) || !Number.isFinite(due)) throw new RangeError('Invalid review time');
  const known =
    exposure.ownerKey === state.ownerKey &&
    exposure.character === state.character &&
    validBounds(exposure.bounds);
  const coldEligible = known ? timestamp(exposure.bounds!.latest) + P.coldGapMs : null;
  const actionable = coldEligible === null ? null : Math.max(due, coldEligible);
  return {
    ownerKey: state.ownerKey,
    profileKey: state.profileKey,
    character: state.character,
    dueAt: state.dueAt,
    coldEligibleAt: coldEligible === null ? null : at(coldEligible),
    actionableAt: actionable === null ? null : at(actionable),
    ready: actionable !== null && actionable <= now,
    reason:
      actionable === null
        ? 'waiting-for-evidence'
        : actionable <= now
          ? 'due'
          : due > now
            ? 'upcoming'
            : 'waiting-for-gap'
  };
}

import { MORSE } from '../sequence';
import { canonical, LEARNING_POLICY as P, timestamp } from './policy';
import type {
  CheckPlan,
  Counts,
  EvaluatedCheck,
  GoalProfile,
  Observation,
  Outcome,
  TargetResult,
  TimeBounds
} from './types';

export const profileKey = (profile: GoalProfile): string => canonical(profile);
export function validBounds(bounds: TimeBounds | null): bounds is TimeBounds {
  return (
    bounds !== null &&
    typeof bounds === 'object' &&
    ['monotonic-anchored', 'wall-clock-bounded'].includes(bounds.source) &&
    Number.isFinite(timestamp(bounds.earliest)) &&
    timestamp(bounds.earliest) <= timestamp(bounds.latest)
  );
}
export function coldGapMs(probe: TargetResult['firstProbe']): number | null {
  if (!probe || !validBounds(probe.presentedAt) || !validBounds(probe.priorExposure)) return null;
  const gap = timestamp(probe.presentedAt.earliest) - timestamp(probe.priorExposure.latest);
  return gap >= 0 ? gap : null;
}
const normalize = (value: string) => value.trim().toUpperCase();

/** Correctness derives from the first response, never a supplied success flag. */
export function assessObservation(character: string, observation: Observation): Outcome {
  const finalCorrect =
    typeof observation.finalResponse === 'string'
      ? normalize(observation.finalResponse) === character
      : null;
  const result = (kind: Outcome['kind'], eligible = false, unassistedCorrect = false): Outcome => ({
    kind,
    eligible,
    unassistedCorrect,
    unassistedAttempt:
      eligible &&
      observation.helpBeforeResponse === false &&
      observation.replayCountBeforeResponse === 0,
    finalCorrect
  });
  if (
    (observation.firstResponse !== null && typeof observation.firstResponse !== 'string') ||
    (observation.finalResponse !== null && typeof observation.finalResponse !== 'string') ||
    typeof observation.skipped !== 'boolean'
  )
    return result('unknown');
  if (
    observation.audioValid === false ||
    observation.interruptionInvalidated === true ||
    (observation.firstResponse === null && !observation.skipped)
  )
    return result('unmeasured');
  if (
    observation.audioValid !== true ||
    observation.interruptionInvalidated !== false ||
    typeof observation.helpBeforeResponse !== 'boolean' ||
    observation.replayCountBeforeResponse === null ||
    !Number.isSafeInteger(observation.replayCountBeforeResponse) ||
    observation.replayCountBeforeResponse < 0 ||
    !['keyboard', 'full-alphabet'].includes(observation.responseInterface)
  )
    return result('unknown');
  if (observation.skipped)
    return observation.firstResponse?.trim() ? result('unknown') : result('skipped', true);
  if (normalize(observation.firstResponse ?? '') !== character) return result('incorrect', true);
  if (observation.helpBeforeResponse || observation.replayCountBeforeResponse > 0)
    return result('supported', true);
  return result('unassisted', true, true);
}

const emptyCounts = (): Counts => ({ eligible: 0, unassistedCorrect: 0, finalCorrect: 0 });
const add = (counts: Counts, outcome: Outcome): Counts => ({
  eligible: counts.eligible + Number(outcome.eligible),
  unassistedCorrect: counts.unassistedCorrect + Number(outcome.unassistedCorrect),
  finalCorrect: counts.finalCorrect + Number(outcome.eligible && outcome.finalCorrect === true)
});

/** Invalid context remains visible but cannot certify a completed check. */
export function evaluateCheck(
  plan: CheckPlan,
  observations: readonly Observation[],
  completedAt: string | null
): EvaluatedCheck {
  const issues = new Set<string>();
  const taught = new Set(plan.introducedCharacters);
  const targets = new Set(plan.targets);
  const promptIds = new Set(plan.prompts.map((prompt) => prompt.id));
  const symbols = new Set(plan.prompts.map((prompt) => prompt.character));
  const otherSymbols = [...taught].filter((character) => !targets.has(character));
  if (
    plan.purpose !== 'mixed-check' ||
    !plan.id ||
    !plan.ownerKey ||
    plan.policyVersion !== P.version ||
    !plan.profile.id ||
    plan.profile.task !== 'single-character' ||
    plan.profile.audioCondition !== 'clean' ||
    plan.profile.responseSupport !== 'open' ||
    !Number.isInteger(plan.profile.charWpm) ||
    plan.profile.charWpm < 5 ||
    plan.profile.charWpm > 50
  )
    issues.add('unsupported-context');
  if (
    !Number.isFinite(timestamp(plan.startedAt)) ||
    (completedAt !== null &&
      (!Number.isFinite(timestamp(completedAt)) ||
        timestamp(completedAt) < timestamp(plan.startedAt)))
  )
    issues.add('invalid-time');
  if (!plan.freshOrder || plan.feedback !== 'after-check') issues.add('unsupported-assessment');
  if (
    targets.size !== plan.targets.length ||
    targets.size < 1 ||
    targets.size > P.maxTargets ||
    taught.size < 2 ||
    [...taught].some((ch) => !MORSE[ch]) ||
    [...targets].some((ch) => !taught.has(ch))
  )
    issues.add('invalid-targets');
  if (
    promptIds.size !== plan.prompts.length ||
    plan.prompts.some(
      (prompt) =>
        !prompt.id ||
        !['target', 'anchor'].includes(prompt.role) ||
        !taught.has(prompt.character) ||
        (prompt.role === 'target') !== targets.has(prompt.character)
    )
  )
    issues.add('invalid-plan');
  if (symbols.size < Math.min(4, taught.size)) issues.add('insufficient-mix');
  for (const character of targets) {
    if (
      plan.prompts.filter((prompt) => prompt.character === character && prompt.role === 'target')
        .length !== P.opportunitiesPerTarget
    )
      issues.add('invalid-target-count');
  }
  if (
    plan.prompts.filter((prompt) => prompt.role === 'anchor').length !==
    (otherSymbols.length ? P.anchorCount : 0)
  )
    issues.add('invalid-anchor-count');
  const byId = new Map<string, Observation>();
  const byPrompt = new Map<string, Observation>();
  const presentations = new Set<string>();
  for (const observation of observations) {
    const prior = byId.get(observation.id);
    if (prior) {
      if (canonical(prior) !== canonical(observation)) issues.add('conflicting-observation');
      continue;
    }
    byId.set(observation.id, observation);
    if (
      !observation.id ||
      !observation.presentationId ||
      observation.ownerKey !== plan.ownerKey ||
      observation.checkId !== plan.id ||
      !promptIds.has(observation.promptId)
    ) {
      issues.add('invalid-observation-scope');
      continue;
    }
    if (byPrompt.has(observation.promptId) || presentations.has(observation.presentationId)) {
      issues.add('duplicate-presentation');
      continue;
    }
    if (
      observation.firstPresentedAt !== null &&
      (!validBounds(observation.firstPresentedAt) ||
        timestamp(observation.firstPresentedAt.latest) < timestamp(plan.startedAt) ||
        (completedAt !== null &&
          timestamp(observation.firstPresentedAt.earliest) > timestamp(completedAt)))
    )
      issues.add('invalid-presentation-time');
    byPrompt.set(observation.promptId, observation);
    presentations.add(observation.presentationId);
  }
  let whole = emptyCounts();
  const results: Record<string, TargetResult> = {};
  for (const character of targets)
    results[character] = { ...emptyCounts(), firstProbe: null, trials: [] };
  let previousPresentation: TimeBounds | null = null;
  for (const prompt of plan.prompts) {
    const observation = byPrompt.get(prompt.id);
    if (!observation) {
      issues.add('missing-observation');
      continue;
    }
    if (validBounds(observation.firstPresentedAt)) {
      if (
        previousPresentation &&
        timestamp(observation.firstPresentedAt.latest) < timestamp(previousPresentation.earliest)
      )
        issues.add('conflicting-presentation-order');
      previousPresentation = observation.firstPresentedAt;
    }
    const outcome = assessObservation(prompt.character, observation);
    if (!outcome.eligible) issues.add('unmeasured-opportunity');
    whole = add(whole, outcome);
    if (prompt.role === 'target') {
      const previous = results[prompt.character];
      if (previous)
        results[prompt.character] = {
          ...add(previous, outcome),
          trials: [
            ...previous.trials,
            {
              observationId: observation.id,
              promptId: prompt.id,
              enteredText:
                typeof observation.firstResponse === 'string'
                  ? normalize(observation.firstResponse)
                  : null,
              outcome
            }
          ],
          firstProbe: previous.firstProbe ?? {
            outcome,
            presentedAt: observation.firstPresentedAt,
            priorExposure: observation.priorExposure
          }
        };
    }
  }
  return {
    id: plan.id,
    ownerKey: plan.ownerKey,
    policyVersion: plan.policyVersion,
    profileKey: profileKey(plan.profile),
    startedAt: plan.startedAt,
    completedAt,
    complete: completedAt !== null && issues.size === 0,
    issues: [...issues].sort(),
    evidenceIds: [...byId.keys()].sort(),
    targets: results,
    whole,
    reviewCycleIds: { ...plan.reviewCycleIds }
  };
}

import { learningHistory, type LearningHistoryEntry } from './learning-history';
/** One owner-scoped prospective projection for Home, Lessons, Progress and Results. */
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from './learning-evidence';
import { createAttemptRepository } from './attempt-repository';
import { openTrainingDb } from './training-db';
import { readClientCwSettings } from '../cwSync';
import { priorExposure, exposureBeforeProbe, wireBounds } from '../learning-evidence/exposure';
import { LESSONS } from '../training/sequence';
import { recordedCharacters } from '../training/targeted-review';
import { evaluateCheck, profileKey } from '../training/learning-policy/assessment';
import {
  projectCharacterEvidence,
  type CharacterEvidence
} from '../training/learning-policy/evidence';
import { detectConfusions, type ConfusionFinding } from '../training/learning-policy/confusion';
import { canonical, LEARNING_POLICY as P, timestamp } from '../training/learning-policy/policy';
import {
  initializeReview,
  reconcileReview,
  reviewReadiness,
  type ReviewReadiness,
  type ReviewState
} from '../training/learning-policy/review';
import { recommendNext, type Recommendation } from '../training/learning-policy/recommendation';
import type {
  Attainment,
  CheckPlan,
  Counts,
  EvaluatedCheck,
  GoalProfile,
  Observation
} from '../training/learning-policy/types';

export interface LearningCharacter {
  character: string;
  exposure: 'recorded' | 'unknown';
  current: CharacterEvidence['current'] & { counts: Counts | null };
  proficiency: Attainment | null;
  retention: Attainment | null;
  review: ReviewReadiness | null;
  reviewState: ReviewState | null;
  lastAssessedAt: string | null;
  evidence: CharacterEvidence;
}
export interface LearningSnapshot {
  ownerKey: string;
  profile: GoalProfile;
  profileKey: string;
  coverage: 'complete' | 'local-only' | 'partial';
  knownCharacters: string[];
  hasProspectiveEvidence: boolean;
  characters: LearningCharacter[];
  checks: EvaluatedCheck[];
  history: LearningHistoryEntry[];
  recommendation: ReturnType<typeof recommendNext>;
  frontierStep: number;
  courseComplete: boolean;
  confusions: readonly ConfusionFinding[];
  issues: string[];
}
export interface LearningSnapshotOptions {
  ownerKey: string;
  nowIso?: string;
  profile?: GoalProfile;
  coverage?: LearningSnapshot['coverage'];
  records?: readonly EvidenceRecord[];
  knownCharacters?: readonly string[];
}
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function activeLearningProfile(charWpm = readClientCwSettings().char_wpm): GoalProfile {
  return {
    id: `single-character-clean-open-${charWpm}`,
    task: 'single-character',
    charWpm,
    audioCondition: 'clean',
    responseSupport: 'open'
  };
}
export function profileFromWire(value: unknown): GoalProfile | null {
  const profile = object(value);
  if (
    !text(profile.id) ||
    profile.task !== 'single-character' ||
    profile.audio_condition !== 'clean' ||
    profile.response_support !== 'open' ||
    !Number.isInteger(profile.char_wpm) ||
    Number(profile.char_wpm) < 5 ||
    Number(profile.char_wpm) > 50
  )
    return null;
  return {
    id: text(profile.id),
    task: 'single-character',
    charWpm: Number(profile.char_wpm),
    audioCondition: 'clean',
    responseSupport: 'open'
  };
}
export function checkPlanFromWire(record: EvidenceRecord, ownerKey: string): CheckPlan | null {
  const profile = profileFromWire(record.profile);
  if (
    record.kind !== 'plan' ||
    record.purpose !== 'mixed-check' ||
    !profile ||
    !text(record.session_id) ||
    !Array.isArray(record.prompts)
  )
    return null;
  return {
    purpose: 'mixed-check',
    id: text(record.session_id),
    ownerKey,
    policyVersion: record.policy_version,
    profile,
    startedAt: text(record.started_at),
    targets: strings(record.targets),
    introducedCharacters: strings(record.introduced_characters),
    prompts: record.prompts.map((value) => {
      const prompt = object(value);
      return {
        id: text(prompt.id),
        character: text(prompt.character),
        role: prompt.role as 'target' | 'anchor'
      };
    }),
    freshOrder: record.fresh_order === true,
    feedback: record.feedback as 'after-check',
    reviewCycleIds: object(record.review_cycle_ids) as Record<string, string>
  };
}
export function observationFromWire(record: EvidenceRecord, ownerKey: string): Observation {
  const nullableText = (value: unknown) => (typeof value === 'string' ? value : null);
  const nullableBoolean = (value: unknown) => (typeof value === 'boolean' ? value : null);
  return {
    id: record.id,
    ownerKey,
    checkId: text(record.session_id),
    promptId: text(record.prompt_id),
    presentationId: text(record.presentation_id),
    firstResponse: nullableText(record.first_response),
    finalResponse: nullableText(record.final_response),
    skipped: record.skipped as boolean,
    replayCountBeforeResponse:
      typeof record.replay_count_before_response === 'number'
        ? record.replay_count_before_response
        : null,
    helpBeforeResponse: nullableBoolean(record.help_before_response),
    audioValid: nullableBoolean(record.audio_valid),
    interruptionInvalidated: nullableBoolean(record.interruption_invalidated),
    responseInterface: record.response_interface as Observation['responseInterface'],
    firstPresentedAt: wireBounds(record.first_presented_at),
    priorExposure: wireBounds(record.prior_exposure)
  };
}
function claimsFromWire(records: readonly EvidenceRecord[], ownerKey: string): Attainment[] {
  const corrections = new Map<string, EvidenceRecord>();
  for (const record of records)
    if (record.kind === 'milestone-correction') corrections.set(text(record.milestone_id), record);
  return records.flatMap((record) => {
    if (record.kind !== 'milestone') return [];
    const profile = profileFromWire(record.profile),
      character = text(record.character),
      kind = record.milestone_kind;
    if (
      !profile ||
      !LESSONS.join('').includes(character) ||
      character.length !== 1 ||
      !['proficiency', 'retention'].includes(text(kind)) ||
      !Number.isFinite(timestamp(text(record.awarded_at)))
    )
      return [];
    const scope = profileKey(profile),
      key = canonical([ownerKey, scope, character, kind, P.version]),
      checkIds = strings(record.check_ids),
      correction = corrections.get(record.id);
    return [
      {
        claimId: record.id,
        key,
        basisKey: canonical([key, ...checkIds]),
        ownerKey,
        profileKey: scope,
        policyVersion: record.policy_version,
        character,
        kind: kind as Attainment['kind'],
        awardedAt: text(record.awarded_at),
        checkIds,
        status:
          correction?.status === 'unverified'
            ? 'unverified'
            : correction?.status === 'superseded'
              ? 'superseded'
              : 'verified'
      } satisfies Attainment
    ];
  });
}
function selectedAward(evidence: CharacterEvidence, kind: Attainment['kind']): Attainment | null {
  const invalid = (award: Attainment) =>
    evidence.revalidation.some(
      (c) =>
        c.reason === 'invalid-witness' &&
        (c.claimId
          ? c.claimId === award.claimId
          : c.awardKey === award.key && canonical(c.checkIds) === canonical(award.checkIds))
    );
  return (
    [...evidence.historical, ...evidence.candidates]
      .filter(
        (award) =>
          award.kind === kind &&
          award.policyVersion === P.version &&
          award.status !== 'unverified' &&
          award.status !== 'superseded' &&
          !invalid(award)
      )
      .sort(
        (a, b) =>
          timestamp(a.awardedAt) - timestamp(b.awardedAt) ||
          Number(a.status === 'provisional') - Number(b.status === 'provisional')
      )[0] ?? null
  );
}

export function projectLearningSnapshot(
  records: readonly EvidenceRecord[],
  options: LearningSnapshotOptions
): LearningSnapshot {
  const nowIso = options.nowIso ?? new Date().toISOString(),
    now = timestamp(nowIso),
    profile = options.profile ?? activeLearningProfile(),
    scope = profileKey(profile),
    coverage =
      options.coverage ?? (options.ownerKey.startsWith('account:') ? 'partial' : 'local-only');
  const checks: EvaluatedCheck[] = [],
    issues: string[] = [];
  for (const record of records) {
    const plan = checkPlanFromWire(record, options.ownerKey);
    if (!plan) continue;
    const observations = records
      .filter((r) => r.kind === 'observation' && r.session_id === plan.id)
      .map((r) => {
        const observation = observationFromWire(r, options.ownerKey);
        const character = plan.prompts.find((p) => p.id === observation.promptId)?.character;
        const guard = records.find(
          (r) => r.kind === 'exposure-open' && r.presentation_id === observation.presentationId
        );
        const close =
          guard && records.find((r) => r.kind === 'exposure-close' && r.open_id === guard.id);
        const end = character ? wireBounds(object(close?.last_exposure)[character]) : null;
        const delivery =
          close?.end_reason === 'completed' && end
            ? observation.audioValid
            : close?.end_reason === 'stopped'
              ? false
              : null;
        return {
          ...observation,
          audioValid: delivery,
          priorExposure: character
            ? exposureBeforeProbe(
                records,
                character,
                observation.presentationId,
                observation.firstPresentedAt
              )
            : null
        };
      });
    const terminal = records.find((r) => r.kind === 'terminal' && r.session_id === plan.id);
    const check = evaluateCheck(
      plan,
      observations,
      terminal?.status === 'completed' ? text(terminal.ended_at) : null
    );
    // A terminal manifest must match the complete observation set before certification.
    if (
      terminal?.status === 'completed' &&
      canonical([...strings(terminal.observation_ids)].sort()) !==
        canonical(observations.map((o) => o.id).sort())
    ) {
      checks.push({
        ...check,
        complete: false,
        issues: [...check.issues, 'terminal-manifest-mismatch']
      });
      issues.push(`terminal-manifest-mismatch:${plan.id}`);
    } else checks.push(check);
  }
  const seen = new Set(options.knownCharacters ?? []);
  for (const record of records) {
    if (record.kind === 'exposure-open')
      for (const character of strings(record.characters)) seen.add(character);
  }
  const knownCharacters = [...LESSONS.join('')].filter((character) => seen.has(character));
  const claims = claimsFromWire(records, options.ownerKey);
  const characters = [...LESSONS.join('')].map((character) => {
    const evidence = projectCharacterEvidence(checks, claims, {
      ownerKey: options.ownerKey,
      profileKey: scope,
      character,
      nowIso,
      coverage
    });
    const proficiency = selectedAward(evidence, 'proficiency'),
      retention = selectedAward(evidence, 'retention');
    const currentCheck = checks.find((c) => c.id === evidence.current.checkId),
      counts = currentCheck?.targets[character] ?? null;
    const screeningTimes = records
      .filter(
        (r) =>
          r.kind === 'plan' &&
          r.purpose === 'screening' &&
          profileFromWire(r.profile) &&
          profileKey(profileFromWire(r.profile)!) === scope
      )
      .flatMap((plan) => {
        const terminal = records.find(
          (r) =>
            r.kind === 'terminal' && r.session_id === plan.session_id && r.status === 'completed'
        );
        if (!terminal) return [];
        const promptIds = new Set(
          (plan.prompts as { id: string; character: string }[])
            .filter((p) => p.character === character)
            .map((p) => p.id)
        );
        return records
          .filter(
            (r) =>
              r.kind === 'observation' &&
              r.session_id === plan.session_id &&
              promptIds.has(text(r.prompt_id)) &&
              r.audio_valid === true &&
              r.interruption_invalidated === false
          )
          .map(() => text(terminal.ended_at));
      });
    const relevant = checks
      .filter(
        (c) =>
          c.profileKey === scope &&
          c.targets[character] &&
          c.completedAt &&
          timestamp(c.completedAt) <= now
      )
      .sort((a, b) => timestamp(b.completedAt!) - timestamp(a.completedAt!));
    let state: ReviewState | null = null,
      review: ReviewReadiness | null = null;
    if (proficiency) {
      const result = reconcileReview(initializeReview(proficiency), checks, nowIso);
      state = result.state;
      issues.push(...result.issues);
      review = reviewReadiness(
        state,
        { ownerKey: options.ownerKey, character, bounds: priorExposure(records, character, now) },
        nowIso
      );
    }
    return {
      character,
      exposure: seen.has(character) ? ('recorded' as const) : ('unknown' as const),
      current: { ...evidence.current, counts },
      proficiency,
      retention,
      review,
      reviewState: state,
      lastAssessedAt:
        [...screeningTimes, ...relevant.map((c) => c.completedAt!)]
          .filter((t) => Number.isFinite(timestamp(t)) && timestamp(t) <= now)
          .sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null,
      evidence
    };
  });
  let attained = 0;
  for (const lesson of LESSONS) {
    if (
      ![...lesson].every(
        (character) => characters.find((c) => c.character === character)?.proficiency
      )
    )
      break;
    attained++;
  }
  const latestWholeCheck =
    checks
      .filter(
        (c) =>
          c.complete && c.profileKey === scope && c.completedAt && timestamp(c.completedAt) <= now
      )
      .sort((a, b) => timestamp(b.completedAt!) - timestamp(a.completedAt!))[0] ?? null;
  const difficult = characters.filter((c) => c.evidence.repeatedDifficulty);
  const repairRounds = difficult.map((character) => {
    const assessed = checks
      .filter(
        (c) =>
          c.complete &&
          c.profileKey === scope &&
          c.targets[character.character] &&
          c.completedAt &&
          timestamp(c.completedAt) <= now
      )
      .sort((a, b) => timestamp(a.completedAt!) - timestamp(b.completedAt!));
    let improvedAt = assessed[0]?.completedAt ?? nowIso,
      previous = assessed[0]?.targets[character.character].unassistedCorrect ?? 0;
    for (const check of assessed.slice(1)) {
      const correct = check.targets[character.character].unassistedCorrect;
      if (correct > previous) improvedAt = check.completedAt!;
      previous = correct;
    }
    return records
      .filter(
        (r) =>
          r.kind === 'plan' &&
          r.purpose === 'coaching' &&
          strings(r.targets).includes(character.character)
      )
      .filter((plan) =>
        records.some(
          (r) =>
            r.kind === 'terminal' &&
            r.session_id === plan.session_id &&
            r.status === 'completed' &&
            timestamp(text(r.ended_at)) > timestamp(improvedAt) &&
            timestamp(text(r.ended_at)) <= now
        )
      ).length;
  });
  const recommendation = recommendNext({
    ownerKey: options.ownerKey,
    profileKey: scope,
    nowIso,
    coverage,
    pendingSave: false,
    interruptedSession: false,
    completedDueCheck: Boolean(
      latestWholeCheck && Object.keys(latestWholeCheck.reviewCycleIds).length
    ),
    repairRoundsSinceImprovement: Math.max(0, ...repairRounds),
    characters: characters
      .filter((c) => seen.has(c.character) || c.proficiency)
      .map((c) => ({ ...c, readiness: c.review })),
    latestWholeCheck
  });
  if (recommendation.primary.reason === 'calibrate' && knownCharacters.length >= 2)
    recommendation.primary = { ...recommendation.primary, targets: knownCharacters.slice(0, 2) };
  return {
    ownerKey: options.ownerKey,
    profile,
    profileKey: scope,
    coverage,
    knownCharacters,
    hasProspectiveEvidence: records.some((r) => r.kind === 'plan') || claims.length > 0,
    characters,
    checks,
    history: learningHistory(records),
    recommendation,
    frontierStep: Math.min(attained + 1, LESSONS.length),
    courseComplete: attained === LESSONS.length,
    confusions: detectConfusions(checks, {
      ownerKey: options.ownerKey,
      profileKey: scope,
      nowIso,
      coverage
    }),
    issues: [...issues, ...characters.flatMap((c) => c.evidence.issues)]
  };
}
export async function loadLearningSnapshot(
  options: LearningSnapshotOptions
): Promise<LearningSnapshot> {
  let records = options.records;
  if (!records) {
    const db = await openLearningEvidenceDb();
    try {
      records = await createLearningEvidenceRepository(db, options.ownerKey).all();
    } finally {
      db.close();
    }
  }
  let known = options.knownCharacters;
  if (!known) {
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      known = recordedCharacters(
        await createAttemptRepository(db, options.ownerKey).getAttemptsByTimeRange(
          '0001-01-01T00:00:00.000Z',
          options.nowIso ?? new Date().toISOString()
        )
      );
    } catch {
      known = [];
    } finally {
      db?.close();
    }
  }
  return projectLearningSnapshot(records, { ...options, knownCharacters: known });
}
export function learningRecommendationHref(
  recommendation: Recommendation,
  knownCharacters: readonly string[] = []
): string {
  const targets = [...recommendation.targets];
  if (recommendation.reason === 'load-history') return '/settings#learning-evidence';
  if (recommendation.reason === 'new-lesson')
    return `/morse/learn/session?step=${recommendation.lesson ?? 1}`;
  if (recommendation.reason === 'return-screening') return '/morse/learn/session?review=return';
  if (recommendation.reason === 'repair') {
    if (targets.length < 2) {
      const partner = knownCharacters.find((c) => !targets.includes(c));
      if (partner) targets.push(partner);
    }
    if (targets.length >= 2)
      return `/morse/learn/session?review=${encodeURIComponent(targets.slice(0, 2).join(''))}`;
  }
  if (['calibrate', 'check-current', 'due-check', 'repair'].includes(recommendation.reason))
    return targets.length
      ? `/morse/learn/session?check=${encodeURIComponent(targets.slice(0, 2).join(''))}`
      : '/morse/learn';
  if (recommendation.reason === 'contextual-practice') return '/morse/practice';
  if (recommendation.reason === 'rest-or-adjust') return '/settings';
  return '/morse/learn';
}

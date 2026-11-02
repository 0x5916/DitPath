import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from './learning-evidence';
import {
  projectLearningSnapshot,
  activeLearningProfile,
  learningRecommendationHref,
  returnScreeningTargets
} from './learning-snapshot';
import { buildMixedCheck } from '../training/learning-policy/mixed-plan';
import { exposureBeforeProbe, wireBounds } from '../learning-evidence/exposure';
const ownerKey = 'unclaimed',
  profile = activeLearningProfile(20),
  day = 86400000,
  base = Date.parse('2026-10-01T00:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
const bounds = (time: number) => ({
  earliest: iso(time),
  latest: iso(time),
  source: 'wall-clock-bounded' as const
});
const record = (
  id: string,
  kind: EvidenceRecord['kind'],
  payload: Record<string, unknown>
): EvidenceRecord => ({
  id,
  kind,
  policy_version: 'learning-policy-1.0',
  recorded_at: iso(base),
  ...payload
});
function check(id: string, time: number) {
  let sequence = 0;
  const built = buildMixedCheck({
    ownerKey,
    targets: ['K', 'M'],
    knownCharacters: ['K', 'M'],
    profile,
    effWpm: 12,
    freqHz: 600,
    startedAt: iso(time),
    checkId: id,
    promptId: () => `${id}_p${sequence++}`
  });
  const plan = record(`plan_${id}`, 'plan', {
    session_id: id,
    purpose: 'mixed-check',
    profile: {
      id: profile.id,
      task: profile.task,
      char_wpm: 20,
      audio_condition: 'clean',
      response_support: 'open'
    },
    started_at: iso(time),
    introduced_characters: ['K', 'M'],
    targets: ['K', 'M'],
    prompts: built.plan.prompts,
    fresh_order: true,
    feedback: 'after-check'
  });
  const observations: string[] = [];
  const records: EvidenceRecord[] = [plan];
  for (const [i, prompt] of built.plan.prompts.entries()) {
    const presentation = `sound_${prompt.id}`,
      start = time + i * 3000 + 1000,
      open = `open_${presentation}`;
    records.push(
      record(open, 'exposure-open', {
        presentation_id: presentation,
        characters: [prompt.character],
        source: 'mixed-check',
        started_at: bounds(start - 500)
      })
    );
    records.push(
      record(`close_${presentation}`, 'exposure-close', {
        open_id: open,
        end_reason: 'completed',
        last_exposure: { [prompt.character]: bounds(start + 1000) }
      })
    );
    const observation = record(`answer_${prompt.id}`, 'observation', {
      session_id: id,
      prompt_id: prompt.id,
      presentation_id: presentation,
      first_response: prompt.character,
      final_response: prompt.character,
      skipped: false,
      replay_count_before_response: 0,
      help_before_response: false,
      audio_valid: true,
      interruption_invalidated: false,
      response_interface: 'keyboard',
      first_presented_at: bounds(start),
      prior_exposure: bounds(base - 30 * day)
    });
    records.push(observation);
    observations.push(observation.id);
  }
  records.push(
    record(`end_${id}`, 'terminal', {
      session_id: id,
      status: 'completed',
      ended_at: iso(time + 60000),
      observation_ids: observations
    })
  );
  return records;
}
const project = (records: EvidenceRecord[], now = base + 10 * day) =>
  projectLearningSnapshot(records, {
    ownerKey,
    profile,
    nowIso: iso(now),
    knownCharacters: ['K', 'M']
  });
describe('unified learning projection', () => {
  it('builds provisional proficiency, current ability and review readiness from separate checks', () => {
    const records = [...check('one', base), ...check('two', base + day)];
    const snapshot = project(records, base + day + 60000);
    expect(snapshot.characters.find((c) => c.character === 'K')).toMatchObject({
      current: { criterion: 'met' },
      proficiency: { status: 'provisional' },
      retention: null,
      review: { ready: false }
    });
    expect(snapshot.recommendation.primary.reason).toBe('new-lesson');
    expect(project(records, base + 20 * day).characters[0].proficiency).not.toBeNull();
    expect(project(records, base + 20 * day).characters[0].current.freshness).toBe('stale');
  });
  it('reconstructs exposure from every recorded mode and ignores a forged prior snapshot', () => {
    const records = [
      ...check('one', base),
      ...check('two', base + day),
      ...check('cold1', base + 3 * day),
      ...check('cold2', base + 9 * day)
    ];
    expect(project(records).characters[0].retention).not.toBeNull();
    const warm = base + 9 * day - 3600000;
    records.push(
      record('warm', 'exposure-open', {
        presentation_id: 'warm',
        characters: ['K'],
        source: 'reference',
        started_at: bounds(warm)
      })
    );
    expect(project(records).characters[0].retention).toBeNull();
    records.push(
      record('warm_close', 'exposure-close', {
        open_id: 'warm',
        end_reason: 'completed',
        last_exposure: { K: bounds(warm + 1000) }
      })
    );
    expect(project(records).characters[0].retention).toBeNull();
    expect(project(records).characters.find((c) => c.character === 'M')!.retention).not.toBeNull();
  });
  it('requires actual delivery closure and a complete manifest, while replay stays in the denominator', () => {
    const records = check('one', base);
    const observation = records.find((r) => r.kind === 'observation')!;
    observation.replay_count_before_response = 1;
    let result = project(records).checks[0];
    expect(result.complete).toBe(true);
    expect(result.whole).toMatchObject({ eligible: 20, unassistedCorrect: 19, finalCorrect: 20 });
    const close = records.find((r) => r.kind === 'exposure-close')!;
    close.end_reason = 'stopped';
    result = project(records).checks[0];
    expect(result.complete).toBe(false);
    expect(result.whole.eligible).toBe(19);
    records.find((r) => r.kind === 'terminal')!.observation_ids = [];
    expect(
      project(records).issues.some((issue) => issue.startsWith('terminal-manifest-mismatch'))
    ).toBe(true);
  });
  it('preserves explicit server corrections instead of silently resurrecting their basis', () => {
    const records = [...check('one', base), ...check('two', base + day)];
    const candidate = project(records).characters[0].proficiency!;
    records.push(
      record('legacy:lp:m:claim', 'milestone', {
        character: 'K',
        profile: records[0].profile,
        milestone_kind: 'proficiency',
        awarded_at: candidate.awardedAt,
        check_ids: candidate.checkIds
      })
    );
    expect(project(records).characters[0].proficiency?.status).toBe('verified');
    records.push(
      record('legacy:lp:c:correction', 'milestone-correction', {
        milestone_id: 'legacy:lp:m:claim',
        status: 'unverified'
      })
    );
    expect(project(records).characters[0].proficiency).toBeNull();
  });
  it('does not recommend unrecorded targets or merge accounts, speed profiles and partial coverage', () => {
    const records = check('one', base);
    expect(project(records).recommendation.primary.targets.every((ch) => 'KM'.includes(ch))).toBe(
      true
    );
    const changed = projectLearningSnapshot(records, {
      ownerKey,
      profile: activeLearningProfile(25),
      nowIso: iso(base + day),
      knownCharacters: ['K', 'M']
    });
    expect(changed.characters.every((c) => !c.proficiency)).toBe(true);
    expect(
      projectLearningSnapshot(records, {
        ownerKey,
        profile,
        coverage: 'partial',
        nowIso: iso(base + day)
      }).recommendation.primary.reason
    ).toBe('load-history');
  });
  it('preserves return-screening targets in the session link', () => {
    const records = [...check('one', base), ...check('two', base + day)];
    const snapshot = project(records, base + 30 * day);
    expect(snapshot.recommendation.primary).toMatchObject({
      reason: 'return-screening',
      targets: ['K', 'M']
    });
    expect(learningRecommendationHref(snapshot.recommendation.primary)).toBe(
      '/morse/learn/session?review=return&targets=KM'
    );
  });
  it('validates screening targets against attainment and recorded characters', () => {
    const records = [...check('one', base), ...check('two', base + day)];
    records.push(
      record('exposed-r', 'exposure-open', {
        presentation_id: 'exposed-r',
        characters: ['R'],
        source: 'reference',
        started_at: bounds(base)
      })
    );
    const snapshot = project(records, base + 30 * day);
    expect(snapshot.knownCharacters).toEqual(['K', 'M', 'R']);
    expect(returnScreeningTargets(snapshot, null)).toEqual(['K', 'M']);
    expect(returnScreeningTargets(snapshot, ['M', 'K'])).toEqual(['M', 'K']);
    expect(returnScreeningTargets(snapshot, ['R'])).toBeNull();
    expect(returnScreeningTargets(snapshot, ['K', 'Z'])).toBeNull();
    expect(returnScreeningTargets(snapshot, ['K', 'K'])).toBeNull();
    const unattained = projectLearningSnapshot([], {
      ownerKey,
      profile,
      nowIso: iso(base + 30 * day),
      knownCharacters: ['K', 'M']
    });
    // Recorded exposure without attainment is not a screening source.
    expect(returnScreeningTargets(unattained, null)).toEqual([]);
    expect(returnScreeningTargets(unattained, ['K'])).toBeNull();
    const empty = projectLearningSnapshot([], {
      ownerKey,
      profile,
      nowIso: iso(base + 30 * day),
      knownCharacters: []
    });
    expect(returnScreeningTargets(empty, null)).toEqual([]);
    expect(returnScreeningTargets(empty, ['K'])).toBeNull();
  });
  it('does not project permanently rejected records as learning evidence', () => {
    const first = check('one', base),
      second = check('two', base + day),
      records = [...first, ...second];
    expect(project(records, base + day + 60000).characters[0].proficiency).not.toBeNull();
    const excluded = projectLearningSnapshot(records, {
      ownerKey,
      profile,
      nowIso: iso(base + day + 60000),
      knownCharacters: ['K', 'M'],
      excludedRecordIds: second.map((entry) => entry.id)
    });
    expect(excluded.characters[0].proficiency).toBeNull();
    expect(excluded.characters[0].current.criterion).toBe('met');
  });

  it('presents a rejected terminal as rejected evidence and leaves independent checks unaffected', () => {
    const first = check('one', base),
      second = check('two', base + day),
      snapshot = projectLearningSnapshot([...first, ...second], {
        ownerKey,
        profile,
        nowIso: iso(base + day + 60000),
        knownCharacters: ['K', 'M'],
        excludedRecordIds: ['end_two']
      });
    expect(snapshot.history.find((entry) => entry.id === 'two')).toMatchObject({
      status: 'incomplete',
      recordedStatus: 'completed',
      evidenceStatus: 'rejected'
    });
    expect(snapshot.history.find((entry) => entry.id === 'one')).toMatchObject({
      status: 'completed',
      evidenceStatus: 'complete'
    });
    expect(snapshot.checks.find((entry) => entry.id === 'two')).toMatchObject({
      complete: false
    });
  });

  it('uses the same manifest rule as History when a terminal manifest is malformed', () => {
    const records = check('dup', base),
      terminal = records.find((entry) => entry.id === 'end_dup')!,
      firstId = String((terminal.observation_ids as string[])[0]);
    terminal.observation_ids = [firstId, firstId];
    const snapshot = project(records);
    expect(snapshot.checks[0]).toMatchObject({ complete: false });
    expect(snapshot.checks[0].issues).toContain('terminal-manifest-mismatch');
    expect(snapshot.history[0]).toMatchObject({
      status: 'incomplete',
      evidenceStatus: 'missing'
    });
  });

  it.each([
    [
      'missing closure',
      (records: EvidenceRecord[]) => {
        records.splice(
          records.findIndex((entry) => entry.kind === 'exposure-close'),
          1
        );
      }
    ],
    [
      'stopped closure',
      (records: EvidenceRecord[]) => {
        records.find((entry) => entry.kind === 'exposure-close')!.end_reason = 'stopped';
      }
    ],
    [
      'recovered closure',
      (records: EvidenceRecord[]) => {
        records.find((entry) => entry.kind === 'exposure-close')!.end_reason = 'recovery';
      }
    ]
  ])('does not refresh screening freshness on %s', (_name, breakEvidence) => {
    const plan = record('plan_screen', 'plan', {
      session_id: 'screen',
      purpose: 'screening',
      profile: {
        id: profile.id,
        task: profile.task,
        char_wpm: 20,
        audio_condition: 'clean',
        response_support: 'open'
      },
      started_at: iso(base),
      targets: ['K'],
      prompts: [{ id: 'sp', character: 'K' }],
      fresh_order: true,
      feedback: 'immediate',
      char_wpm: 20,
      eff_wpm: 12
    });
    const open = record('open_screen', 'exposure-open', {
      session_id: 'screen',
      presentation_id: 'tone',
      characters: ['K'],
      source: 'screening',
      started_at: bounds(base)
    });
    const close = record('close_screen', 'exposure-close', {
      open_id: 'open_screen',
      end_reason: 'completed',
      last_exposure: { K: bounds(base + 1000) }
    });
    const observation = record('answer_screen', 'observation', {
      session_id: 'screen',
      prompt_id: 'sp',
      presentation_id: 'tone',
      first_response: 'K',
      final_response: 'K',
      skipped: false,
      replay_count_before_response: 0,
      help_before_response: false,
      audio_valid: true,
      interruption_invalidated: false,
      response_interface: 'keyboard',
      first_presented_at: bounds(base + 500)
    });
    const terminal = record('end_screen', 'terminal', {
      session_id: 'screen',
      status: 'completed',
      ended_at: iso(base + 60000),
      observation_ids: [observation.id]
    });
    const records = [plan, open, close, observation, terminal];
    breakEvidence(records);
    const snapshot = project(records);
    expect(snapshot.characters.find((entry) => entry.character === 'K')?.lastAssessedAt).toBeNull();
  });

  it('keeps a valid screening assessment fresh while granting no proficiency', () => {
    const plan = record('plan_screen', 'plan', {
      session_id: 'screen',
      purpose: 'screening',
      profile: {
        id: profile.id,
        task: profile.task,
        char_wpm: 20,
        audio_condition: 'clean',
        response_support: 'open'
      },
      started_at: iso(base),
      targets: ['K'],
      prompts: [{ id: 'sp', character: 'K' }],
      fresh_order: true,
      feedback: 'immediate',
      char_wpm: 20,
      eff_wpm: 12
    });
    const open = record('open_screen', 'exposure-open', {
      session_id: 'screen',
      presentation_id: 'tone',
      characters: ['K'],
      source: 'screening',
      started_at: bounds(base)
    });
    const close = record('close_screen', 'exposure-close', {
      open_id: 'open_screen',
      end_reason: 'completed',
      last_exposure: { K: bounds(base + 1000) }
    });
    const observation = record('answer_screen', 'observation', {
      session_id: 'screen',
      prompt_id: 'sp',
      presentation_id: 'tone',
      first_response: 'K',
      final_response: 'K',
      skipped: false,
      replay_count_before_response: 0,
      help_before_response: false,
      audio_valid: true,
      interruption_invalidated: false,
      response_interface: 'keyboard',
      first_presented_at: bounds(base + 500)
    });
    const terminal = record('end_screen', 'terminal', {
      session_id: 'screen',
      status: 'completed',
      ended_at: iso(base + 60000),
      observation_ids: [observation.id]
    });
    const snapshot = project([plan, open, close, observation, terminal]);
    const character = snapshot.characters.find((entry) => entry.character === 'K');
    expect(character?.lastAssessedAt).toBe(iso(base + 60000));
    expect(character?.proficiency).toBeNull();
    expect(character?.reviewState).toBeNull();
  });

  it('uses a recovered closure as a conservative exposure bound for later gaps', () => {
    const earlier = base,
      recoveredAt = base + 3_600_000;
    const records = [
      record('recovered', 'exposure-open', {
        presentation_id: 'recovered',
        characters: ['K'],
        source: 'reference',
        started_at: bounds(earlier)
      }),
      record('recovered-close', 'exposure-close', {
        open_id: 'recovered',
        end_reason: 'recovery',
        last_exposure: { K: bounds(recoveredAt) }
      })
    ];
    const cold = recoveredAt + 20 * 3_600_000 + 1,
      warm = recoveredAt + 19 * 3_600_000;
    const coldPrior = exposureBeforeProbe(records, 'K', 'cold', bounds(cold)),
      warmPrior = exposureBeforeProbe(records, 'K', 'warm', bounds(warm));
    expect(Date.parse(coldPrior!.latest)).toBe(recoveredAt);
    expect(cold - Date.parse(coldPrior!.latest)).toBeGreaterThanOrEqual(20 * 3_600_000);
    expect(warm - Date.parse(warmPrior!.latest)).toBeLessThan(20 * 3_600_000);
  });
  it('rounds sub-millisecond upper bounds outwards and excludes only the probe itself', () => {
    expect(
      wireBounds({
        earliest: '2026-10-01T00:00:00.000001Z',
        latest: '2026-10-01T00:00:00.000001Z',
        source: 'wall-clock-bounded'
      })
    ).toMatchObject({ earliest: iso(base), latest: iso(base + 1) });
    const records = check('one', base),
      first = records.find((r) => r.kind === 'observation')!;
    expect(
      exposureBeforeProbe(
        records,
        String(first.first_response),
        String(first.presentation_id),
        wireBounds(first.first_presented_at)
      )
    ).toBeNull();
  });
});

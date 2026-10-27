import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from './learning-evidence';
import { projectLearningSnapshot, activeLearningProfile } from './learning-snapshot';
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

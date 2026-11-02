import type { EvidenceRecord } from './learning-evidence';
import { deliveryValidity } from '../learning-evidence/exposure';
import { canonical } from '../training/learning-policy/policy';

export type HistoryStatus = 'in-progress' | 'completed' | 'incomplete' | 'abandoned';
/**
 * The terminal manifest is an immutable historical record. Delivery
 * completeness is reconstructed separately so an old `completed` label cannot
 * hide missing, stopped, invalid or unresolved exposure evidence.
 */
export type HistoryEvidenceStatus =
  'complete' | 'missing' | 'stopped' | 'invalid' | 'unresolved' | 'rejected' | null;
export interface LearningHistoryOptions {
  /** Permanently rejected evidence stays visible for diagnosis, never as active work. */
  excludedRecordIds?: readonly string[];
}

export interface LearningHistoryEntry {
  id: string;
  purpose: 'coaching' | 'screening' | 'mixed-check';
  /** Evaluated presentation status; use this for learner-facing labels. */
  status: HistoryStatus;
  /** The terminal status exactly as stored, retained for diagnosis. */
  recordedStatus: HistoryStatus;
  evidenceStatus: HistoryEvidenceStatus;
  at: string;
  targets: string[];
  charWpm: number;
  effWpm: number;
  planned: number;
  answered: number;
  correct: number | null;
  replayed: number;
  skipped: number;
  invalid: number;
  responses: { id: string; expected: string; answer: string | null }[];
  milestones: { id: string; character: string; kind: string; corrected: boolean }[];
}

/**
 * Canonical terminal manifest rule shared by History and the authoritative
 * projection. Missing/non-array manifests are empty; duplicate, extra, or
 * missing ids never match, while reordered complete ids do.
 */
export function terminalManifestMatches(
  manifest: unknown,
  observationIds: readonly string[]
): boolean {
  const ids = Array.isArray(manifest)
    ? manifest.filter((id): id is string => typeof id === 'string')
    : [];
  return canonical([...ids].sort()) === canonical([...observationIds].sort());
}
function deliveryCompleteness(
  records: readonly EvidenceRecord[],
  prompts: readonly { id: string; character: string }[],
  observations: readonly EvidenceRecord[],
  terminal: EvidenceRecord
): HistoryEvidenceStatus {
  const byPrompt = new Map<string, EvidenceRecord>();
  for (const observation of observations) {
    const promptId = typeof observation.prompt_id === 'string' ? observation.prompt_id : '';
    if (!promptId || byPrompt.has(promptId)) return 'invalid';
    byPrompt.set(promptId, observation);
  }
  if (
    !terminalManifestMatches(
      terminal.observation_ids,
      observations.map((item) => item.id)
    )
  )
    return 'missing';
  let status: HistoryEvidenceStatus = 'complete';
  for (const prompt of prompts) {
    const observation = byPrompt.get(prompt.id);
    if (!observation) return 'missing';
    const guard = records.find(
      (record) =>
        record.kind === 'exposure-open' && record.presentation_id === observation.presentation_id
    );
    if (!guard) return 'unresolved';
    const close = records.find(
      (record) => record.kind === 'exposure-close' && record.open_id === guard.id
    );
    if (close?.end_reason === 'stopped') return 'stopped';
    if (!close) return 'unresolved';
    if (close.end_reason !== 'completed') return 'unresolved';
    if (observation.interruption_invalidated === true) return 'invalid';
    if (observation.audio_valid === false) return 'invalid';
    const delivery = deliveryValidity(
      records,
      {
        presentationId: String(observation.presentation_id ?? ''),
        audioValid: typeof observation.audio_valid === 'boolean' ? observation.audio_valid : null
      },
      prompt.character
    );
    if (delivery === false) return 'invalid';
    if (delivery !== true && status === 'complete') status = 'unresolved';
  }
  return status;
}

/** Available raw history stays distinct from qualification and from legacy activity. */
export function learningHistory(
  records: readonly EvidenceRecord[],
  options: LearningHistoryOptions = {}
): LearningHistoryEntry[] {
  const excluded = new Set(options.excludedRecordIds ?? []);
  const observations = new Map<string, EvidenceRecord[]>(),
    terminals = new Map<string, EvidenceRecord>();
  const closed = new Set(
    records
      .filter((r) => r.kind === 'exposure-close' && r.end_reason === 'completed')
      .map((r) => r.open_id)
  );
  const delivered = new Set(
    records
      .filter((r) => r.kind === 'exposure-open' && closed.has(r.id))
      .map((r) => r.presentation_id)
  );
  const corrections = new Set(
    records.filter((r) => r.kind === 'milestone-correction').map((r) => r.milestone_id)
  );
  for (const record of records) {
    const id = String(record.session_id ?? '');
    if (record.kind === 'terminal') terminals.set(id, record);
    if (record.kind === 'observation')
      observations.set(id, [...(observations.get(id) ?? []), record]);
  }
  return records
    .filter(
      (r) =>
        r.kind === 'plan' &&
        Array.isArray(r.prompts) &&
        Array.isArray(r.targets) &&
        Number.isFinite(Date.parse(String(r.started_at))) &&
        ['coaching', 'screening', 'mixed-check'].includes(String(r.purpose))
    )
    .map((plan) => {
      const id = String(plan.session_id),
        terminal = terminals.get(id);
      const prompts = plan.prompts as { id: string; character: string }[];
      const answers = observations.get(id) ?? [];
      const recordedStatus = (terminal?.status ?? 'in-progress') as HistoryStatus;
      const rejected =
        excluded.has(plan.id) ||
        (terminal !== undefined && excluded.has(terminal.id)) ||
        answers.some((answer) => excluded.has(answer.id));
      const evidenceStatus: HistoryEvidenceStatus = rejected
        ? 'rejected'
        : terminal?.status === 'completed'
          ? deliveryCompleteness(records, prompts, answers, terminal)
          : null;
      const status: HistoryStatus = rejected
        ? 'incomplete'
        : recordedStatus === 'completed' && evidenceStatus !== 'complete'
          ? 'incomplete'
          : recordedStatus;
      const responses = terminal
        ? answers.map((o) => ({
            id: o.id,
            expected: prompts.find((p) => p.id === o.prompt_id)?.character ?? '',
            answer: typeof o.first_response === 'string' ? o.first_response : null
          }))
        : [];
      return {
        id,
        purpose: plan.purpose as LearningHistoryEntry['purpose'],
        status,
        recordedStatus,
        evidenceStatus,
        at: String(terminal?.ended_at ?? plan.started_at),
        targets: plan.targets as string[],
        charWpm: Number(plan.char_wpm),
        effWpm: Number(plan.eff_wpm),
        planned: prompts.length,
        answered: answers.length,
        correct: terminal
          ? responses.filter((r) => r.answer?.trim().toUpperCase() === r.expected).length
          : null,
        replayed: answers.filter((o) => Number(o.replay_count_before_response) > 0).length,
        skipped: answers.filter((o) => o.skipped === true).length,
        invalid: answers.filter(
          (o) =>
            o.audio_valid !== true ||
            o.interruption_invalidated !== false ||
            !delivered.has(o.presentation_id)
        ).length,
        responses,
        milestones: records
          .filter(
            (r) => r.kind === 'milestone' && Array.isArray(r.check_ids) && r.check_ids.includes(id)
          )
          .map((r) => ({
            id: r.id,
            character: String(r.character),
            kind: String(r.milestone_kind),
            corrected: corrections.has(r.id)
          }))
      };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

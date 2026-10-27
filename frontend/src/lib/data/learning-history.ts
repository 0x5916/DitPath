import type { EvidenceRecord } from './learning-evidence';
export interface LearningHistoryEntry {
  id: string;
  purpose: 'coaching' | 'screening' | 'mixed-check';
  status: 'in-progress' | 'completed' | 'incomplete' | 'abandoned';
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
/** Available raw history stays distinct from qualification and from legacy activity. */
export function learningHistory(records: readonly EvidenceRecord[]): LearningHistoryEntry[] {
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
        status: (terminal?.status ?? 'in-progress') as LearningHistoryEntry['status'],
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

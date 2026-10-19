import type {
  AttemptEvent,
  HistorySessionRecord,
  TrainingSessionRecord
} from './training/v2/types';

export function attemptToWire(a: AttemptEvent) {
  return {
    id: a.id,
    session_id: a.sessionId,
    prompt_id: a.promptId,
    prompt_kind: a.promptKind,
    target_character: a.targetCharacter,
    entered_text: a.enteredText,
    is_correct: a.isCorrect,
    classification: a.classification,
    latency_ms: a.latencyMs,
    replay_count: a.replayCount,
    input_mode: a.inputMode,
    char_wpm: a.charWpm,
    eff_wpm: a.effWpm,
    freq_hz: a.freqHz,
    created_at: a.createdAt
  };
}

export function sessionToWire(s: TrainingSessionRecord) {
  const practice = s.mode === 'practice';
  if (s.status === 'in-progress') throw new Error('Cannot upload unfinished session metadata');
  if (!practice && !s.eventIds) throw new Error('Terminal session has no frozen manifest');
  return {
    session_id: s.id,
    mode: practice ? 'practice' : 'guided',
    curriculum_version: 'koch-39-v1',
    lesson: s.step,
    status: s.status,
    started_at: s.startedAt,
    ended_at: s.completedAt ?? null,
    char_wpm: s.charWpm,
    eff_wpm: s.effWpm,
    freq_hz: s.freqHz,
    prompt_count: s.promptCount,
    attempt_count: practice ? 1 : s.eventIds!.length,
    event_ids: practice ? [] : s.eventIds,
    ...(practice ? { accuracy: s.accuracy, scoring_version: 'practice-copy-v1' } : {})
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid training response');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid training response string');
  return value;
}
function identity(value: unknown): string {
  const id = text(value);
  if (!id.trim() || new TextEncoder().encode(id).length > 128)
    throw new Error('Invalid training response ID');
  return id;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Invalid training response number');
  return value;
}
function integer(value: unknown): number {
  const n = number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid training response integer');
  return n;
}
function timestamp(value: unknown): string {
  const date = text(value);
  if (!date.includes('T') || !Number.isFinite(Date.parse(date)))
    throw new Error('Invalid training response timestamp');
  return new Date(date).toISOString();
}

export function attemptFromWire(value: unknown): AttemptEvent {
  const a = object(value);
  const classification = text(a.classification) as AttemptEvent['classification'];
  const promptKind = text(a.prompt_kind) as AttemptEvent['promptKind'];
  const inputMode = text(a.input_mode) as AttemptEvent['inputMode'];
  if (
    !['automatic', 'developing', 'incorrect', 'missing', 'unmeasured'].includes(classification) ||
    !['introduction', 'unscored-match', 'recall', 'contrast', 'short-group'].includes(promptKind) ||
    !['keyboard', 'grid', 'touch'].includes(inputMode) ||
    typeof a.is_correct !== 'boolean'
  )
    throw new Error('Invalid training attempt response');
  return {
    schemaVersion: 1,
    id: identity(a.id),
    sessionId: identity(a.session_id),
    promptId: identity(a.prompt_id),
    promptKind,
    targetCharacter: text(a.target_character),
    enteredText: text(a.entered_text),
    isCorrect: a.is_correct,
    classification,
    latencyMs: integer(a.latency_ms),
    replayCount: integer(a.replay_count),
    inputMode,
    charWpm: integer(a.char_wpm),
    effWpm: integer(a.eff_wpm),
    freqHz: integer(a.freq_hz),
    createdAt: timestamp(a.created_at)
  };
}

export function sessionFromWire(value: unknown): HistorySessionRecord {
  const s = object(value);
  const legacy = s.source_kind === 'legacy_v1';
  if (
    (!legacy && (s.source_kind !== 'native' || !['guided', 'practice'].includes(text(s.mode)))) ||
    !['completed', 'abandoned'].includes(text(s.status)) ||
    !Array.isArray(s.event_ids)
  )
    throw new Error('Invalid training session response');
  const accuracy = s.accuracy == null ? undefined : number(s.accuracy);
  if (accuracy !== undefined && (accuracy < 0 || accuracy > 1))
    throw new Error('Invalid training score');
  const optionalTime = (v: unknown) => (v == null ? undefined : timestamp(v));
  const optionalInt = (v: unknown) => (v == null ? undefined : integer(v));
  const record: HistorySessionRecord = {
    schemaVersion: 1,
    id: identity(s.session_id),
    mode: legacy ? 'legacy' : (s.mode as 'guided' | 'practice'),
    sourceKind: legacy ? 'legacy_v1' : 'native',
    sourceRecordId: s.source_record_id == null ? undefined : text(s.source_record_id),
    step: integer(s.lesson),
    accuracy,
    startedAt: optionalTime(s.started_at),
    completedAt: optionalTime(s.ended_at),
    occurredAt: timestamp(s.occurred_at),
    occurredAtSource: text(s.occurred_at_source),
    charWpm: optionalInt(s.char_wpm),
    effWpm: optionalInt(s.eff_wpm),
    freqHz: optionalInt(s.freq_hz),
    status: s.status as 'completed' | 'abandoned',
    promptCount: optionalInt(s.prompt_count),
    completedPromptCount: optionalInt(s.attempt_count),
    eventIds: s.event_ids.map(identity)
  };
  if (
    !legacy &&
    (!record.startedAt ||
      record.charWpm == null ||
      record.effWpm == null ||
      record.freqHz == null ||
      record.promptCount == null ||
      record.completedPromptCount == null)
  )
    throw new Error('Missing native session measurements');
  return record;
}

export function parseChangePage(value: unknown) {
  const page = object(value);
  if (
    !Array.isArray(page.changes) ||
    page.changes.length > 100 ||
    typeof page.has_more !== 'boolean'
  )
    throw new Error('Invalid training change page');
  const nextCursor = text(page.next_cursor);
  if (!nextCursor) throw new Error('Missing training checkpoint');
  const attempts: AttemptEvent[] = [],
    sessions: HistorySessionRecord[] = [];
  let previous = 0n;
  for (const raw of page.changes) {
    const change = object(raw);
    const revision = text(change.revision);
    if (!/^[1-9]\d*$/.test(revision) || BigInt(revision) <= previous)
      throw new Error('Invalid training revision order');
    previous = BigInt(revision);
    if (change.kind === 'attempt') attempts.push(attemptFromWire(change.record));
    else if (change.kind === 'session') sessions.push(sessionFromWire(change.record));
    else throw new Error('Unknown training change kind');
  }
  if (page.has_more && page.changes.length === 0) throw new Error('Empty continuation page');
  return { attempts, sessions, nextCursor, hasMore: page.has_more };
}

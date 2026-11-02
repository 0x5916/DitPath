import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from './learning-evidence';
import { learningHistory, terminalManifestMatches } from './learning-history';

const envelope = {
  policy_version: 'learning-policy-1.0',
  recorded_at: '2026-10-01T00:00:00.000Z'
};
const bounds = (instant: string) => ({
  earliest: instant,
  latest: instant,
  source: 'wall-clock-bounded' as const
});
const plan: EvidenceRecord = {
  ...envelope,
  id: 'plan',
  kind: 'plan',
  session_id: 's',
  purpose: 'screening',
  started_at: envelope.recorded_at,
  targets: ['K'],
  char_wpm: 20,
  eff_wpm: 12,
  prompts: [
    { id: 'p1', character: 'K' },
    { id: 'p2', character: 'K' }
  ]
};
function observation(id: string, prompt: string, overrides: Record<string, unknown> = {}) {
  return {
    ...envelope,
    id,
    kind: 'observation' as const,
    session_id: 's',
    prompt_id: prompt,
    presentation_id: `tone-${id}`,
    first_response: 'K',
    replay_count_before_response: 0,
    skipped: false,
    audio_valid: true,
    interruption_invalidated: false,
    ...overrides
  } satisfies EvidenceRecord;
}
function guard(id: string, close?: Record<string, unknown>) {
  const records: EvidenceRecord[] = [
    {
      ...envelope,
      id: `open-${id}`,
      kind: 'exposure-open',
      session_id: 's',
      presentation_id: `tone-${id}`,
      characters: ['K'],
      source: 'screening',
      started_at: bounds(envelope.recorded_at)
    }
  ];
  if (close)
    records.push({
      ...envelope,
      id: `close-${id}`,
      kind: 'exposure-close',
      open_id: `open-${id}`,
      end_reason: 'completed',
      last_exposure: { K: bounds(envelope.recorded_at) },
      ...close
    } as EvidenceRecord);
  return records;
}
function completed(...observations: EvidenceRecord[]): EvidenceRecord {
  return {
    ...envelope,
    id: 'terminal',
    kind: 'terminal',
    session_id: 's',
    status: 'completed',
    ended_at: envelope.recorded_at,
    observation_ids: observations.map((record) => record.id)
  };
}

describe('learning history evaluates reconstructed delivery evidence', () => {
  it('keeps a genuinely complete terminal label', () => {
    const first = observation('a', 'p1'),
      second = observation('b', 'p2');
    const [entry] = learningHistory([
      plan,
      ...guard('a', {}),
      ...guard('b', {}),
      first,
      second,
      completed(first, second)
    ]);
    expect(entry).toMatchObject({
      status: 'completed',
      recordedStatus: 'completed',
      evidenceStatus: 'complete'
    });
  });

  it('marks a legacy completed terminal as incomplete when a planned answer is missing', () => {
    const first = observation('a', 'p1');
    const [entry] = learningHistory([plan, ...guard('a', {}), first, completed(first)]);
    expect(entry).toMatchObject({
      status: 'incomplete',
      recordedStatus: 'completed',
      evidenceStatus: 'missing'
    });
  });

  it.each([
    ['stopped', { end_reason: 'stopped' }, {}, 'stopped'],
    ['invalid', {}, { audio_valid: false }, 'invalid'],
    ['unresolved', undefined, {}, 'unresolved']
  ])('marks %s delivery as incomplete evidence', (_name, close, overrides, evidenceStatus) => {
    const first = observation('a', 'p1', overrides),
      second = observation('b', 'p2');
    const [entry] = learningHistory([
      plan,
      ...guard('a', close),
      ...guard('b', {}),
      first,
      second,
      completed(first, second)
    ]);
    expect(entry).toMatchObject({
      status: 'incomplete',
      recordedStatus: 'completed',
      evidenceStatus
    });
  });

  it('uses the authoritative manifest rule for duplicates, extras, order and malformed values', () => {
    expect(terminalManifestMatches(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(terminalManifestMatches(['a', 'a'], ['a', 'b'])).toBe(false);
    expect(terminalManifestMatches(['a'], ['a', 'b'])).toBe(false);
    expect(terminalManifestMatches(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(terminalManifestMatches(undefined, ['a'])).toBe(false);
    expect(terminalManifestMatches(null, ['a'])).toBe(false);
    expect(terminalManifestMatches('a', ['a'])).toBe(false);
    expect(terminalManifestMatches([1], [])).toBe(true);
  });

  it('presents a permanently rejected terminal as rejected evidence, not active work', () => {
    const first = observation('a', 'p1'),
      second = observation('b', 'p2'),
      terminal = completed(first, second);
    const [entry] = learningHistory(
      [plan, ...guard('a', {}), ...guard('b', {}), first, second, terminal],
      { excludedRecordIds: [terminal.id] }
    );
    expect(entry).toMatchObject({
      status: 'incomplete',
      recordedStatus: 'completed',
      evidenceStatus: 'rejected',
      answered: 2,
      correct: 2
    });
    expect(entry.responses).toHaveLength(2);
  });

  it('retains an explicitly incomplete terminal without reinterpreting it', () => {
    const records = [
      plan,
      observation('a', 'p1'),
      {
        ...envelope,
        id: 'terminal',
        kind: 'terminal',
        session_id: 's',
        status: 'incomplete',
        ended_at: envelope.recorded_at,
        observation_ids: ['a']
      } satisfies EvidenceRecord
    ];
    expect(learningHistory(records)[0]).toMatchObject({
      status: 'incomplete',
      recordedStatus: 'incomplete',
      evidenceStatus: null
    });
  });
});

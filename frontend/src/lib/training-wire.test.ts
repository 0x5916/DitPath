import { describe, expect, it } from 'vitest';
import type { AttemptEvent, TrainingSessionRecord } from './training/v2/types';
import {
  attemptFromWire,
  attemptToWire,
  parseChangePage,
  sessionFromWire,
  sessionToWire
} from './training-wire';
const attempt: AttemptEvent = {
  schemaVersion: 1,
  id: 'evidence',
  sessionId: 'guided',
  promptId: 'prompt',
  promptKind: 'recall',
  targetCharacter: 'K',
  enteredText: 'K',
  isCorrect: true,
  classification: 'automatic',
  latencyMs: 1000,
  replayCount: 2,
  inputMode: 'keyboard',
  charWpm: 20,
  effWpm: 12,
  freqHz: 600,
  createdAt: '2026-10-20T00:01:00.000Z'
};
const session: TrainingSessionRecord = {
  schemaVersion: 1,
  id: 'guided',
  mode: 'guided',
  step: 1,
  charWpm: 20,
  effWpm: 12,
  freqHz: 600,
  startedAt: '2026-10-20T00:00:00.000Z',
  completedAt: '2026-10-20T00:02:00.000Z',
  status: 'completed',
  promptCount: 12,
  completedPromptCount: 12,
  eventIds: ['evidence']
};
const nativeWire = () => ({
  ...sessionToWire(session),
  source_kind: 'native',
  source_record_id: null,
  accuracy: 1,
  occurred_at: session.completedAt,
  occurred_at_source: 'client_end'
});
const page = (changes: unknown[], extra: Record<string, unknown> = {}) => ({
  changes,
  next_cursor: 'opaque-checkpoint',
  has_more: false,
  ...extra
});

describe('Training V1 wire mapping', () => {
  it('round-trips guided evidence and normalizes offset timestamps', () => {
    const wire = attemptToWire(attempt);
    expect(wire).toMatchObject({
      id: 'evidence',
      session_id: 'guided',
      replay_count: 2,
      char_wpm: 20
    });
    expect(attemptFromWire({ ...wire, created_at: '2026-10-20T08:01:00+08:00' })).toEqual(attempt);
    expect(wire).not.toHaveProperty('user_id');
    expect(wire).not.toHaveProperty('schemaVersion');
  });
  it('uses the frozen manifest count independently of completed introduction prompts', () => {
    expect(sessionToWire(session)).toMatchObject({
      prompt_count: 12,
      attempt_count: 1,
      event_ids: ['evidence']
    });
    expect(sessionToWire({ ...session, eventIds: [] })).toMatchObject({
      prompt_count: 12,
      attempt_count: 0
    });
  });
  it('uploads practice summaries without guided evidence or passage text', () => {
    const wire = sessionToWire({
      ...session,
      id: 'practice',
      mode: 'practice',
      promptCount: 1,
      completedPromptCount: 1,
      accuracy: 0.125,
      eventIds: []
    });
    expect(wire).toMatchObject({
      mode: 'practice',
      prompt_count: 1,
      attempt_count: 1,
      event_ids: [],
      accuracy: 0.125,
      scoring_version: 'practice-copy-v1'
    });
    expect(wire).not.toHaveProperty('entered_text');
    expect(wire).not.toHaveProperty('transcript');
  });
  it('preserves unknown abandonment end times rather than inventing a completion', () => {
    expect(
      sessionToWire({ ...session, status: 'abandoned', completedAt: undefined })
    ).toMatchObject({ ended_at: null });
  });
  it('rejects unfinished metadata and missing frozen manifests', () => {
    expect(() => sessionToWire({ ...session, status: 'in-progress' })).toThrow(
      'unfinished session'
    );
    expect(() => sessionToWire({ ...session, eventIds: undefined })).toThrow('frozen manifest');
  });
  it('restores native session settings, event identities and occurrence provenance', () => {
    expect(sessionFromWire(nativeWire())).toMatchObject({
      id: 'guided',
      mode: 'guided',
      sourceKind: 'native',
      charWpm: 20,
      effWpm: 12,
      freqHz: 600,
      eventIds: ['evidence'],
      accuracy: 1,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      occurredAt: session.completedAt,
      occurredAtSource: 'client_end'
    });
  });
  it('preserves unknown legacy mode, measurements and timing as unknown', () => {
    const restored = sessionFromWire({
      session_id: 'legacy:row',
      source_kind: 'legacy_v1',
      source_record_id: 'row',
      mode: null,
      status: 'completed',
      lesson: 40,
      accuracy: null,
      started_at: null,
      ended_at: null,
      char_wpm: null,
      eff_wpm: null,
      freq_hz: null,
      prompt_count: null,
      attempt_count: null,
      event_ids: [],
      occurred_at: '2026-10-20T00:00:00Z',
      occurred_at_source: 'legacy_server_receipt'
    });
    expect(restored).toMatchObject({
      mode: 'legacy',
      step: 40,
      sourceKind: 'legacy_v1',
      sourceRecordId: 'row',
      occurredAtSource: 'legacy_server_receipt'
    });
    expect(restored.startedAt).toBeUndefined();
    expect(restored.completedAt).toBeUndefined();
    expect(restored.charWpm).toBeUndefined();
    expect(restored.accuracy).toBeUndefined();
    expect(restored.promptCount).toBeUndefined();
  });
  it.each([
    { id: '' },
    { created_at: 'yesterday' },
    { latency_ms: 1.25 },
    { replay_count: Number.NaN },
    { is_correct: 'true' },
    { classification: 'unknown' },
    { prompt_kind: 'decoded' },
    { input_mode: 'unknown' }
  ])('rejects malformed attempt fields %j', (fields) => {
    expect(() => attemptFromWire({ ...attemptToWire(attempt), ...fields })).toThrow(
      'Invalid training'
    );
  });
  it.each([
    { accuracy: 1.1 },
    { char_wpm: null },
    { mode: 'other' },
    { status: 'in-progress' },
    { event_ids: null }
  ])('rejects malformed native session fields %j', (fields) => {
    expect(() => sessionFromWire({ ...nativeWire(), ...fields })).toThrow();
  });
});

describe('Committed change feed parsing', () => {
  it('keeps revision precision beyond JavaScript safe integers and maps both record kinds', () => {
    const parsed = parseChangePage(
      page([
        { revision: '9007199254740992', kind: 'attempt', record: attemptToWire(attempt) },
        { revision: '9007199254740993', kind: 'session', record: nativeWire() }
      ])
    );
    expect(parsed.attempts).toEqual([attempt]);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.nextCursor).toBe('opaque-checkpoint');
    expect(parsed.hasMore).toBe(false);
  });
  it.each([1, '0', '-1', '1.5', 'abc'])('rejects an invalid revision %j', (revision) => {
    expect(() =>
      parseChangePage(page([{ revision, kind: 'attempt', record: attemptToWire(attempt) }]))
    ).toThrow();
  });
  it('rejects repeated or decreasing revisions before a page can reach storage', () => {
    for (const revisions of [
      ['1', '1'],
      ['2', '1']
    ])
      expect(() =>
        parseChangePage(
          page(
            revisions.map((revision) => ({
              revision,
              kind: 'attempt',
              record: attemptToWire(attempt)
            }))
          )
        )
      ).toThrow('revision');
  });
  it('rejects unknown record kinds and malformed page envelopes', () => {
    expect(() => parseChangePage(page([{ revision: '1', kind: 'settings', record: {} }]))).toThrow(
      'Unknown training'
    );
    expect(() => parseChangePage(page([], { has_more: true }))).toThrow('Empty continuation');
    expect(() => parseChangePage(page([], { next_cursor: '' }))).toThrow(
      'Missing training checkpoint'
    );
    expect(() => parseChangePage(page([], { has_more: 'false' }))).toThrow(
      'Invalid training change page'
    );
    expect(() => parseChangePage(page(Array(101).fill({})))).toThrow(
      'Invalid training change page'
    );
  });
});

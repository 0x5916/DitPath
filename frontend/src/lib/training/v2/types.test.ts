import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTERY_POLICY,
  V2_SCHEMA_VERSION,
  isValidAttemptEvent,
  isValidIsoTimestamp,
  isValidTrainingSessionRecord,
  type AttemptEvent,
  type TrainingSessionRecord
} from './types';
import { createAttemptId, createEntityId, createPromptId, createSessionId } from './ids';

describe('V2 Domain Types & Invariants', () => {
  it('pins V2 schema version to 1', () => {
    expect(V2_SCHEMA_VERSION).toBe(1);
  });

  it('validates standard ISO timestamps', () => {
    expect(isValidIsoTimestamp('2026-10-04T12:00:00.000Z')).toBe(true);
    expect(isValidIsoTimestamp('2026-10-04T12:00:00Z')).toBe(true);
    expect(isValidIsoTimestamp('invalid-date')).toBe(false);
    expect(isValidIsoTimestamp('')).toBe(false);
    expect(isValidIsoTimestamp('2026-10-04')).toBe(false);
  });

  it('validates a well-formed AttemptEvent', () => {
    const validAttempt: AttemptEvent = {
      schemaVersion: 1,
      id: 'att_123',
      sessionId: 'sess_456',
      promptId: 'prm_789',
      promptKind: 'recall',
      targetCharacter: 'T',
      enteredText: 'T',
      isCorrect: true,
      classification: 'automatic',
      latencyMs: 1250,
      replayCount: 0,
      inputMode: 'keyboard',
      charWpm: 20,
      effWpm: 15,
      freqHz: 600,
      createdAt: '2026-10-04T12:00:00.000Z'
    };

    expect(isValidAttemptEvent(validAttempt)).toBe(true);
  });

  it('rejects AttemptEvents with invalid schemaVersion, negative latency, or float replays', () => {
    const base: AttemptEvent = {
      schemaVersion: 1,
      id: 'att_123',
      sessionId: 'sess_456',
      promptId: 'prm_789',
      promptKind: 'recall',
      targetCharacter: 'T',
      enteredText: 'T',
      isCorrect: true,
      classification: 'automatic',
      latencyMs: 1250,
      replayCount: 0,
      inputMode: 'keyboard',
      charWpm: 20,
      effWpm: 15,
      freqHz: 600,
      createdAt: '2026-10-04T12:00:00.000Z'
    };

    expect(isValidAttemptEvent({ ...base, schemaVersion: 2 })).toBe(false);
    expect(isValidAttemptEvent({ ...base, latencyMs: -10 })).toBe(false);
    expect(isValidAttemptEvent({ ...base, latencyMs: 125.5 })).toBe(false);
    expect(isValidAttemptEvent({ ...base, replayCount: 1.5 })).toBe(false);
    expect(isValidAttemptEvent({ ...base, createdAt: 'not-an-iso' })).toBe(false);
    expect(isValidAttemptEvent(null)).toBe(false);
    expect(isValidAttemptEvent({})).toBe(false);
  });

  it('validates a well-formed TrainingSessionRecord', () => {
    const validSession: TrainingSessionRecord = {
      schemaVersion: 1,
      id: 'sess_123',
      step: 1,
      charWpm: 20,
      effWpm: 12,
      freqHz: 600,
      startedAt: '2026-10-04T12:00:00.000Z',
      status: 'in-progress',
      promptCount: 12,
      completedPromptCount: 4
    };

    expect(isValidTrainingSessionRecord(validSession)).toBe(true);
  });

  it('validates default mastery policy thresholds', () => {
    expect(DEFAULT_MASTERY_POLICY.targetAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(DEFAULT_MASTERY_POLICY.maxAutomaticLatencyMs).toBeLessThan(
      DEFAULT_MASTERY_POLICY.maxDevelopingLatencyMs
    );
    expect(DEFAULT_MASTERY_POLICY.minSessionsForStability).toBeGreaterThanOrEqual(2);
  });
});

describe('V2 ID Generators', () => {
  it('generates deterministic IDs with injected clock and random source', () => {
    const mockNow = () => 1700000000000;
    const mockRandom = () => {
      return 0.1; // index 3 in base36: '3'
    };

    const id = createEntityId('test', { now: mockNow, random: mockRandom });
    expect(id.startsWith('test_')).toBe(true);
    expect(id).toBe(`test_${mockNow().toString(36)}_33333333`);
  });

  it('generates distinct IDs using default entropy', () => {
    const id1 = createSessionId();
    const id2 = createSessionId();
    expect(id1.startsWith('sess_')).toBe(true);
    expect(id2.startsWith('sess_')).toBe(true);
    expect(id1).not.toBe(id2);

    expect(createPromptId().startsWith('prm_')).toBe(true);
    expect(createAttemptId().startsWith('att_')).toBe(true);
  });
});

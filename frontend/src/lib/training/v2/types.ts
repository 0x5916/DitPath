/**
 * DitPath V2 Learning Domain Types.
 *
 * Pure data types and contracts only.
 * Invariants:
 * - No dependencies on Svelte, DOM, Web Audio, storage, or network.
 * - All durations and latencies use integer milliseconds (e.g., latencyMs).
 * - All speeds and frequencies have explicit units in field names (charWpm, effWpm, freqHz).
 * - Timestamps are ISO 8601 strings at persistence boundaries.
 * - Attempt events are immutable records of user interaction.
 * - Schema version is explicitly pinned to 1.
 */

export const V2_SCHEMA_VERSION = 1 as const;

export type MasteryStatus = 'new' | 'learning' | 'review' | 'stable';

export interface MasteryPolicy {
  /** Minimum attempts needed for a character before status can become 'stable'. */
  minAttemptsForStability: number;
  /** Minimum distinct sessions required to satisfy the stability criteria. */
  minSessionsForStability: number;
  /** Required rolling accuracy threshold (0.0 - 1.0), e.g. 0.90 (90%). */
  targetAccuracy: number;
  /** Maximum latency in milliseconds to qualify as 'automatic' recognition. */
  maxAutomaticLatencyMs: number;
  /** Maximum latency in milliseconds to qualify as 'developing' recognition. */
  maxDevelopingLatencyMs: number;
  /** Days after last practice when a stable character transitions to 'review' due. */
  reviewIntervalDays: number;
  /** Rolling window size for attempt accuracy calculations. */
  rollingWindowSize: number;
}

export const DEFAULT_MASTERY_POLICY: MasteryPolicy = {
  minAttemptsForStability: 12,
  minSessionsForStability: 2,
  targetAccuracy: 0.9,
  maxAutomaticLatencyMs: 1500,
  maxDevelopingLatencyMs: 3000,
  reviewIntervalDays: 3,
  rollingWindowSize: 20
};

export type PromptKind = 'introduction' | 'unscored-match' | 'recall' | 'contrast' | 'short-group';

export interface PromptSpec {
  kind: PromptKind;
  /** Expected text to be matched or entered (e.g. 'T', 'KM'). */
  expectedText: string;
  /** Symbols included in this prompt sound. */
  characters: string[];
  /** Optional options presented for multiple-choice or contrast prompt variants. */
  options?: string[];
  charWpm: number;
  effWpm: number;
  freqHz: number;
}

export interface Prompt {
  id: string;
  spec: PromptSpec;
  /** 1-based ordinal position of this prompt in the session. */
  ordinal: number;
  isScored: boolean;
}

export type InputMode = 'keyboard' | 'grid' | 'touch';

export type AttemptClassification =
  'automatic' | 'developing' | 'incorrect' | 'missing' | 'unmeasured';

export interface AttemptEvent {
  schemaVersion: typeof V2_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  promptId: string;
  promptKind: PromptKind;
  /** The target character under assessment (e.g. 'T'). */
  targetCharacter: string;
  /** The text entered by the learner, trimmed and normalized. */
  enteredText: string;
  isCorrect: boolean;
  classification: AttemptClassification;
  /** Milliseconds between prompt answer-ready and user submission. */
  latencyMs: number;
  /** Number of times the learner triggered audio replay for this prompt. */
  replayCount: number;
  inputMode: InputMode;
  charWpm: number;
  effWpm: number;
  freqHz: number;
  createdAt: string;
}

export type SessionProgressStatus = 'in-progress' | 'completed' | 'abandoned';

export interface TrainingSessionRecord {
  schemaVersion: typeof V2_SCHEMA_VERSION;
  id: string;
  /** Records saved before mode was introduced are guided lessons. */
  mode?: 'guided' | 'practice';
  accuracy?: number;
  step: number;
  charWpm: number;
  effWpm: number;
  freqHz: number;
  startedAt: string;
  completedAt?: string;
  status: SessionProgressStatus;
  promptCount: number;
  completedPromptCount: number;
  /** Immutable guided attempt manifest, captured when terminal metadata is saved. */
  eventIds?: string[];
}

/** History can contain legacy summaries whose original measurements are unknown. */
export interface HistorySessionRecord {
  schemaVersion: typeof V2_SCHEMA_VERSION;
  id: string;
  mode?: 'guided' | 'practice' | 'legacy';
  accuracy?: number | null;
  step: number;
  charWpm?: number | null;
  effWpm?: number | null;
  freqHz?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  occurredAt?: string;
  occurredAtSource?: string;
  sourceKind?: 'native' | 'legacy_v1';
  sourceRecordId?: string;
  status: SessionProgressStatus;
  promptCount?: number | null;
  completedPromptCount?: number | null;
  eventIds?: string[];
}

export interface SessionSummary {
  sessionId: string;
  step: number;
  totalAttempts: number;
  scoredAttempts: number;
  correctAttempts: number;
  accuracy: number;
  medianLatencyMs: number | null;
  totalReplays: number;
  strongCharacters: string[];
  weakCharacters: string[];
  unlockedNextStep: boolean;
  progressionReasonCode: string;
  completedAt: string;
}

export interface CharacterMastery {
  character: string;
  status: MasteryStatus;
  totalAttempts: number;
  correctAttempts: number;
  rollingAccuracy: number;
  medianLatencyMs: number | null;
  replayRate: number;
  sessionCount: number;
  lastPractisedAt: string | null;
  dueForReviewAt: string | null;
  updatedAt: string;
}

export interface ConfusionPair {
  expected: string;
  actual: string;
  confusionCount: number;
  lastOccurredAt: string;
}

// ── Type Guards and Validation ──────────────────────────────────────────────

export function isValidIsoTimestamp(timestamp: string): boolean {
  if (typeof timestamp !== 'string' || timestamp.trim() === '') return false;
  const parsed = Date.parse(timestamp);
  return !Number.isNaN(parsed) && timestamp.includes('T');
}

export function isValidAttemptEvent(val: unknown): val is AttemptEvent {
  if (!val || typeof val !== 'object') return false;
  const a = val as Record<string, unknown>;

  return (
    a.schemaVersion === V2_SCHEMA_VERSION &&
    typeof a.id === 'string' &&
    typeof a.sessionId === 'string' &&
    typeof a.promptId === 'string' &&
    typeof a.promptKind === 'string' &&
    typeof a.targetCharacter === 'string' &&
    typeof a.enteredText === 'string' &&
    typeof a.isCorrect === 'boolean' &&
    typeof a.classification === 'string' &&
    typeof a.latencyMs === 'number' &&
    Number.isInteger(a.latencyMs) &&
    a.latencyMs >= 0 &&
    typeof a.replayCount === 'number' &&
    Number.isInteger(a.replayCount) &&
    a.replayCount >= 0 &&
    typeof a.inputMode === 'string' &&
    typeof a.charWpm === 'number' &&
    typeof a.effWpm === 'number' &&
    typeof a.freqHz === 'number' &&
    typeof a.createdAt === 'string' &&
    isValidIsoTimestamp(a.createdAt)
  );
}

export function isValidTrainingSessionRecord(val: unknown): val is TrainingSessionRecord {
  if (!val || typeof val !== 'object') return false;
  const s = val as Record<string, unknown>;

  return (
    s.schemaVersion === V2_SCHEMA_VERSION &&
    typeof s.id === 'string' &&
    (s.mode === undefined || s.mode === 'guided' || s.mode === 'practice') &&
    (s.accuracy === undefined ||
      (typeof s.accuracy === 'number' && s.accuracy >= 0 && s.accuracy <= 1)) &&
    typeof s.step === 'number' &&
    typeof s.charWpm === 'number' &&
    typeof s.effWpm === 'number' &&
    typeof s.freqHz === 'number' &&
    typeof s.startedAt === 'string' &&
    isValidIsoTimestamp(s.startedAt) &&
    (s.completedAt === undefined ||
      (typeof s.completedAt === 'string' && isValidIsoTimestamp(s.completedAt))) &&
    (s.status === 'in-progress' || s.status === 'completed' || s.status === 'abandoned') &&
    typeof s.promptCount === 'number' &&
    typeof s.completedPromptCount === 'number'
  );
}

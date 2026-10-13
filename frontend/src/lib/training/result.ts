/**
 * A completed, assessed attempt and the port through which it is recorded.
 *
 * The trainer records results through a `ResultRecorder`; the browser adapter
 * lives in `$lib/progressSync`, and tests use a fake. Abandoned attempts are
 * simply never turned into an `AttemptResult`.
 */

export interface AttemptResult {
  lesson: number;
  charWpm: number;
  effWpm: number;
  /** Accuracy 0–1, as produced by the scoring module. */
  accuracy: number;
  /** ISO timestamp of when the attempt was completed. */
  completedAt: string;
}

export interface ResultRecorder {
  /** Persist a completed attempt. Rejects on failure; callers own fallback. */
  record(result: AttemptResult): Promise<void>;
}

export interface AttemptResultInit {
  lesson: number;
  charWpm: number;
  effWpm: number;
  accuracy: number;
  completedAt?: string;
}

export function createAttemptResult(init: AttemptResultInit): AttemptResult {
  return {
    lesson: init.lesson,
    charWpm: init.charWpm,
    effWpm: init.effWpm,
    accuracy: init.accuracy,
    completedAt: init.completedAt ?? new Date().toISOString()
  };
}

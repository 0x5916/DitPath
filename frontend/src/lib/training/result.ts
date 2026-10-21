/**
 * A completed, assessed attempt. Abandoned attempts are simply never turned
 * into an `AttemptResult`.
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

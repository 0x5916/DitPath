import { contextualPassage, type PracticeContext } from '../training/contextual-practice';
import { createExercise, type Exercise, type RandomSource } from '../training/exercise';
import { LESSONS } from '../training/sequence';
import { calculateDuration } from '../training/timing';
import { createSession, canCheck, transition, type SessionState } from '../training/session';
import { createAttemptResult, type AttemptResult } from '../training/result';
import type { TrainingSessionRecord } from '../training/v2/types';
import { score, diffWords, type DiffToken } from '../score';
import { normalizePlaybackSettings, type PlaybackSettings } from './playback';

export interface CopyAttempt {
  id?: string;
  exercise: Exercise;
  settings: PlaybackSettings;
  session: SessionState;
  duration: number;
  startedAt?: string;
  review: { result: AttemptResult; diffTokens: DiffToken[] } | null;
}

/** Stable prerender state; random exercise generation starts in the browser. */
export function emptyCopyAttempt(): CopyAttempt {
  return {
    exercise: { lesson: 1, text: '' },
    settings: normalizePlaybackSettings({}),
    session: createSession(),
    duration: 0,
    review: null
  };
}

export function normalizePracticeLesson(lesson: number): number {
  return Number.isFinite(lesson) ? Math.min(LESSONS.length, Math.max(1, Math.trunc(lesson))) : 1;
}

/** Free copy practice keeps passage scores separate from guided mastery. */
export function createCopyAttempt(
  lesson: number,
  values: PlaybackSettings,
  previous?: CopyAttempt,
  random?: RandomSource,
  context: PracticeContext = 'groups'
): CopyAttempt {
  const settings = normalizePlaybackSettings(values);
  const exercise =
    context === 'groups'
      ? createExercise({ lesson: normalizePracticeLesson(lesson), ...settings, random })
      : { lesson: LESSONS.length, context, text: contextualPassage(context, random) };
  const next = previous && transition(previous.session, { type: 'new-exercise' });
  return {
    exercise,
    settings,
    session: next?.ok ? next.state : createSession(),
    duration: calculateDuration(exercise.text, settings.charWpm, settings.effWpm),
    review: null
  };
}

export function copyPlaybackEvent(
  attempt: CopyAttempt,
  type: 'start' | 'stop',
  timestamp?: string
): CopyAttempt {
  const next = transition(attempt.session, { type });
  return next.ok
    ? {
        ...attempt,
        session: next.state,
        startedAt:
          attempt.startedAt ??
          (type === 'start' ? (timestamp ?? new Date().toISOString()) : undefined)
      }
    : attempt;
}

/** Converts a reviewed passage into activity history without recognition evidence. */
export function createPracticeSessionRecord(
  attempt: CopyAttempt,
  id: string
): TrainingSessionRecord | null {
  if (!attempt.review || !attempt.startedAt) return null;
  return {
    schemaVersion: 1,
    id,
    mode: 'practice',
    accuracy: attempt.review.result.accuracy,
    step: attempt.exercise.lesson,
    charWpm: attempt.settings.charWpm,
    effWpm: attempt.settings.effWpm,
    freqHz: attempt.settings.freq,
    startedAt: attempt.startedAt,
    completedAt: attempt.review.result.completedAt,
    status: 'completed',
    promptCount: 1,
    completedPromptCount: 1
  };
}

/** Allow a whole extra passage of mistakes, with work proportional to the exercise. */
export function copyInputLimit(reference: string): number {
  return Math.max(1, reference.length * 2);
}

export function boundCopyInput(reference: string, input: string): string {
  return input.slice(0, copyInputLimit(reference));
}

export function reviewCopyAttempt(
  attempt: CopyAttempt,
  input: string,
  completedAt?: string
): CopyAttempt {
  if (!canCheck(attempt.session)) return attempt;
  const copy = boundCopyInput(attempt.exercise.text, input);
  if (!copy.trim()) return attempt;
  const result = createAttemptResult({
    lesson: attempt.exercise.lesson,
    charWpm: attempt.settings.charWpm,
    effWpm: attempt.settings.effWpm,
    accuracy: score(attempt.exercise.text, copy),
    completedAt
  });
  const next = transition(attempt.session, { type: 'check', result });
  return next.ok
    ? {
        ...attempt,
        session: next.state,
        review: { result, diffTokens: diffWords(attempt.exercise.text, copy) }
      }
    : attempt;
}

/**
 * Exercise generation.
 *
 * Generation is explicit (a call, never a reactive expression) and takes an
 * injected random source, so a caller can create one stable exercise per
 * attempt and tests are deterministic.
 */

import { getLessonChars } from './sequence';
import { calculateDuration, getFarnsworthWpmSet } from './timing';
import { randomChar, randomInt } from '../random';
import type { RandomSource } from '../random';

export type { RandomSource };

export interface Exercise {
  /** Lesson the exercise was generated for. */
  lesson: number;
  /** Passage to send; content stays fixed for the life of the exercise. */
  text: string;
}

export interface ExerciseOptions {
  lesson: number;
  charWpm: number;
  effWpm: number;
  /** Approximate transmission length in seconds. Defaults to 60. */
  targetSeconds?: number;
  /** Fixed group size (2–7 random when null). */
  groupSize?: number | null;
  random?: RandomSource;
}

function getGroupSize(groupSize: number | null, random: RandomSource): number {
  return groupSize ?? randomInt(2, 7, random);
}

function requireGroupSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new RangeError('Group size must be a positive safe integer');
}

export function generateTimedLesson(
  lesson: number,
  targetDur: number,
  charWpm: number,
  effWpm: number,
  groupSize: number | null = null,
  random: RandomSource = Math.random
): string {
  if (!Number.isFinite(targetDur)) throw new RangeError('Target duration must be finite');
  if (targetDur <= 0) return '';
  if (!Number.isSafeInteger(lesson) || lesson < 1)
    throw new RangeError('Lesson must be a positive safe integer');
  if (!Number.isFinite(charWpm) || charWpm <= 0 || !Number.isFinite(effWpm) || effWpm <= 0)
    throw new RangeError('Morse speeds must be positive and finite');
  if (groupSize !== null) requireGroupSize(groupSize);

  let result = '';
  let total = 0;

  const lessonChars: string = getLessonChars(lesson);
  const gap = calculateDuration(' ', charWpm, effWpm);
  if (!Number.isFinite(gap) || gap < 0)
    throw new RangeError('Morse spacing must be finite and nonnegative');
  const { letterSpace } = getFarnsworthWpmSet(charWpm, effWpm);
  const shortestCharacter = Math.min(
    ...Array.from(lessonChars, (char) => calculateDuration(char, charWpm, effWpm))
  );

  while (total < targetDur) {
    const size = getGroupSize(groupSize, random);
    requireGroupSize(size);
    // Every possible group would overshoot by more than the time remaining.
    // Avoid constructing enormous fixed groups that would be discarded anyway.
    const shortestGroup = size * shortestCharacter + (size - 1) * letterSpace + gap;
    // Keep a conservative margin here; the exact rounding/fit decision is below.
    if (shortestGroup > 4 * (targetDur - total)) break;
    let group = '';

    for (let i = 0; i < size; i++) {
      const char = randomChar(lessonChars, random);
      if (char === undefined) throw new RangeError('Random source must return a number in [0, 1)');
      group += char;
    }

    const groupDur = calculateDuration(group, charWpm, effWpm);
    const withGapDur = groupDur + gap;
    const nextTotal = total + withGapDur;
    if (!Number.isFinite(nextTotal) || nextTotal <= total)
      throw new RangeError('Exercise generation must make finite timing progress');
    const overshoot = nextTotal - targetDur;

    if (overshoot > 0) {
      const left = targetDur - total;

      if (left < overshoot) break;

      result += group;
      break;
    }
    result += group + ' ';
    total = nextTotal;
  }
  return result;
}

/**
 * Create one exercise up front. The returned `text` never changes; callers
 * regenerate explicitly when an attempt is completed or discarded.
 */
export function createExercise(options: ExerciseOptions): Exercise {
  const {
    lesson,
    charWpm,
    effWpm,
    targetSeconds = 60,
    groupSize = null,
    random = Math.random
  } = options;

  return {
    lesson,
    text: generateTimedLesson(lesson, targetSeconds, charWpm, effWpm, groupSize, random)
  };
}

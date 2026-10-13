/**
 * Exercise generation.
 *
 * Generation is explicit (a call, never a reactive expression) and takes an
 * injected random source, so a caller can create one stable exercise per
 * attempt and tests are deterministic.
 */

import { getLessonChars } from './sequence';
import { calculateDuration } from './timing';
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

export function generateTimedLesson(
  lesson: number,
  targetDur: number,
  charWpm: number,
  effWpm: number,
  groupSize: number | null = null,
  random: RandomSource = Math.random
): string {
  let result = '';
  let total = 0;

  const lessonChars: string = getLessonChars(lesson);
  const gap = calculateDuration(' ', charWpm, effWpm);

  while (true) {
    const size = getGroupSize(groupSize, random);
    let group = '';

    for (let i = 0; i < size; i++) {
      group += randomChar(lessonChars, random);
    }

    const groupDur = calculateDuration(group, charWpm, effWpm);
    const withGapDur = groupDur + gap;
    const overshoot = total + withGapDur - targetDur;

    if (overshoot > 0) {
      const left = targetDur - total;

      if (left < overshoot) break;

      result += group;
      break;
    }
    result += group + ' ';
    total += withGapDur;
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

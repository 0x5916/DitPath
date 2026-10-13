import { describe, expect, it } from 'vitest';
import { calculateDuration } from './timing';
import { createExercise, generateTimedLesson } from './exercise';
import { getLessonChars } from './sequence';

const constant = (value: number) => () => value;

describe('generateTimedLesson with injected randomness', () => {
  it('is deterministic for a given random source', () => {
    const first = generateTimedLesson(1, 60, 20, 10, null, constant(0));
    const second = generateTimedLesson(1, 60, 20, 10, null, constant(0));
    expect(first).toBe(second);
    // group size 2, character K (first char of lesson 1), 18 full groups fit.
    expect(first).toBe('KK '.repeat(18));
  });

  it('only uses characters from the lesson set', () => {
    for (let lesson = 1; lesson <= 5; lesson++) {
      const text = generateTimedLesson(lesson, 30, 20, 10, null, constant(0.37));
      const allowed = new Set(getLessonChars(lesson));
      for (const char of text) {
        if (char === ' ') continue;
        expect(allowed.has(char), `lesson ${lesson} produced ${char}`).toBe(true);
      }
    }
  });

  it('honours an explicit group size', () => {
    const text = generateTimedLesson(1, 12, 20, 10, 2, constant(0.5));
    for (const group of text.trim().split(' ')) {
      expect(group).toHaveLength(2);
    }
  });

  it('fills roughly the requested duration at the configured speed', () => {
    const text = generateTimedLesson(1, 30, 20, 10, 4, constant(0));
    const duration = calculateDuration(text, 20, 10);
    // The last group may overshoot, but never by more than one group + gap.
    expect(duration).toBeGreaterThan(30 - 12);
    expect(duration).toBeLessThan(30 + 12);
  });
});

describe('createExercise', () => {
  it('captures the lesson and a deterministic passage', () => {
    const exercise = createExercise({ lesson: 2, charWpm: 20, effWpm: 10, random: constant(0) });
    expect(exercise.lesson).toBe(2);
    expect(exercise.text).toBe(generateTimedLesson(2, 60, 20, 10, null, constant(0)));
  });

  it('defaults to a 60-second target', () => {
    const exercise = createExercise({ lesson: 1, charWpm: 20, effWpm: 10, random: constant(0) });
    expect(exercise.text).toBe('KK '.repeat(18));
  });

  it('accepts a custom target and group size', () => {
    const exercise = createExercise({
      lesson: 1,
      charWpm: 20,
      effWpm: 10,
      targetSeconds: 12,
      groupSize: 2,
      random: constant(0.5)
    });
    expect(
      exercise.text
        .trim()
        .split(' ')
        .every((group) => group.length === 2)
    ).toBe(true);
  });
});

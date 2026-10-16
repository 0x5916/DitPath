import { describe, expect, it, vi } from 'vitest';
import { createExercise, generateTimedLesson } from './exercise';
import { getLessonChars, LESSONS } from './sequence';
import { calculateDuration } from './timing';

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

// A regression reaches this sentinel instead of blocking the test worker in
// the old unbounded loop or constructing an enormous fixed group.
function unexpectedRandom() {
  return vi.fn(() => {
    throw new Error('generation should not sample random characters');
  });
}

describe('exercise input boundary', () => {
  it.each([Number.NaN, Infinity, -Infinity, '' as unknown as number])(
    'rejects a malformed target duration before generation: %s',
    (target) => {
      const random = unexpectedRandom();
      expect(() => generateTimedLesson(1, target, 20, 12, 2, random)).toThrow(RangeError);
      expect(random).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1, Number.NaN, Infinity, -Infinity, '' as unknown as number])(
    'rejects malformed character/effective rates before generation: %s',
    (rate) => {
      const random = unexpectedRandom();
      expect(() => generateTimedLesson(1, 60, rate, 12, 2, random)).toThrow(RangeError);
      expect(() => generateTimedLesson(1, 60, 20, rate, 2, random)).toThrow(RangeError);
      expect(random).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1, 1.5, Number.NaN, Infinity, -Infinity, '' as unknown as number, 2 ** 53])(
    'rejects a malformed fixed group size before generation: %s',
    (size) => {
      const random = unexpectedRandom();
      expect(() => generateTimedLesson(1, 60, 20, 12, size, random)).toThrow(RangeError);
      expect(random).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1, 1.5, Number.NaN, Infinity, '' as unknown as number])(
    'rejects a malformed/empty lesson set instead of appending undefined: %s',
    (lesson) => {
      const random = unexpectedRandom();
      expect(() => generateTimedLesson(lesson, 60, 20, 12, 2, random)).toThrow(RangeError);
      expect(random).not.toHaveBeenCalled();
    }
  );

  it.each([0, -1])('preserves empty output for a nonpositive target: %s', (target) => {
    const random = unexpectedRandom();
    expect(generateTimedLesson(1, target, 20, 12, 2, random)).toBe('');
    expect(random).not.toHaveBeenCalled();
  });

  it('rejects nonfinite or backwards timing before generation', () => {
    const random = unexpectedRandom();
    expect(() => generateTimedLesson(1, 60, Number.MIN_VALUE, 12, 2, random)).toThrow(RangeError);
    expect(() => generateTimedLesson(1, 60, 5, 50, 2, random)).toThrow(RangeError);
    expect(random).not.toHaveBeenCalled();
  });

  it('does not construct a huge valid fixed group that cannot fit the target', () => {
    const random = unexpectedRandom();
    expect(generateTimedLesson(1, 60, 20, 12, 1_000_000_000, random)).toBe('');
    expect(random).not.toHaveBeenCalled();
  });

  it('rejects a malformed sampled group and unsupported character sample', () => {
    const random = vi.fn(() => Infinity);
    expect(() => generateTimedLesson(1, 60, 20, 12, null, random)).toThrow(RangeError);
    expect(random).toHaveBeenCalledTimes(1);
    expect(() => generateTimedLesson(1, 60, 20, 12, 2, () => Number.NaN)).toThrow(RangeError);
  });

  it('preserves fixed groups and the existing cumulative set beyond the final lesson', () => {
    expect(generateTimedLesson(1, 12, 20, 10, 1, () => 0.5)).toBe('M '.repeat(6));
    expect(generateTimedLesson(1, 20, 20, 10, 8, () => 0.5)).toBe('MMMMMMMM MMMMMMMM ');
    expect(generateTimedLesson(LESSONS.length + 1, 12, 20, 10, 2, () => 0.5)).toBe(
      generateTimedLesson(LESSONS.length, 12, 20, 10, 2, () => 0.5)
    );
    expect(createExercise({ lesson: 1, charWpm: 20, effWpm: 12, targetSeconds: 0 }).text).toBe('');
  });
});

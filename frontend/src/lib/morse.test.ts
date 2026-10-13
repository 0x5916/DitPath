import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LESSONS,
  MORSE,
  calculateDuration,
  generateTimedLesson,
  getFarnsworthWpmSet,
  getLessonChars
} from '$lib/morse';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Koch sequence and cumulative character sets', () => {
  it('keeps the existing lesson order, starting with the K/M pair', () => {
    expect(LESSONS).toHaveLength(39);
    expect(LESSONS[0]).toBe('KM');
    expect(LESSONS[1]).toBe('R');
    expect(LESSONS[38]).toBe('X');
  });

  it('builds cumulative sets with getLessonChars', () => {
    expect(getLessonChars(0)).toBe('');
    expect(getLessonChars(1)).toBe('KM');
    expect(getLessonChars(2)).toBe('KMR');
    expect(getLessonChars(3)).toBe('KMRS');
    expect(getLessonChars(LESSONS.length)).toBe(LESSONS.join(''));
  });

  it('adds characters monotonically as lessons progress', () => {
    for (let lesson = 2; lesson <= LESSONS.length; lesson++) {
      const previous = new Set(getLessonChars(lesson - 1));
      const current = getLessonChars(lesson);
      expect(current.length).toBeGreaterThan(getLessonChars(lesson - 1).length);
      for (const char of previous) {
        expect(current).toContain(char);
      }
    }
  });

  it('has a Morse pattern for every character in the curriculum', () => {
    for (const lesson of LESSONS) {
      for (const char of lesson) {
        expect(MORSE[char], `pattern for ${char}`).toMatch(/^[.-]+$/);
      }
    }
  });

  it('keeps the canonical patterns used by playback and display', () => {
    expect(MORSE['A']).toBe('.-');
    expect(MORSE['K']).toBe('-.-');
    expect(MORSE['M']).toBe('--');
    expect(MORSE['0']).toBe('-----');
    expect(MORSE['?']).toBe('..--..');
  });
});

describe('Farnsworth timing', () => {
  // Independently calculated from the standard formula, with the app's
  // char-dot of 1.2 / charWpm:
  //   charDot    = 1.2 / 20               = 0.06
  //   tFarn      = (60 / 10 - 0.06 * 31) / 19
  //   dash       = 3 * charDot            = 0.18
  //   letterGap  = 3 * tFarn
  //   wordGap    = 7 * tFarn
  const charDot = 0.06;
  const tFarn = (60 / 10 - charDot * 31) / 19; // 0.21789473684210527
  const dash = 0.18;
  const letterSpace = 3 * tFarn;
  const wordSpace = 7 * tFarn;

  it('returns the expected timing values for 20/10 WPM', () => {
    expect(getFarnsworthWpmSet(20, 10)).toEqual({
      charDot,
      tFarn,
      dash,
      symbolSpace: charDot,
      letterSpace,
      wordSpace
    });
  });

  it('computes durations for individual characters', () => {
    expect(calculateDuration('E', 20, 10)).toBeCloseTo(charDot, 12);
    expect(calculateDuration('M', 20, 10)).toBeCloseTo(2 * dash + charDot, 12);
    expect(calculateDuration('I', 20, 10)).toBeCloseTo(3 * charDot, 12);
    expect(calculateDuration('K', 20, 10)).toBeCloseTo(2 * dash + 2 * charDot + charDot, 12);
  });

  it('inserts letter gaps between characters and word gaps at spaces', () => {
    expect(calculateDuration('EE', 20, 10)).toBeCloseTo(charDot + letterSpace + charDot, 12);
    expect(calculateDuration('E E', 20, 10)).toBeCloseTo(
      charDot + letterSpace + wordSpace + charDot,
      12
    );
    expect(calculateDuration('KK', 20, 10)).toBeCloseTo(
      2 * (2 * dash + 3 * charDot) + letterSpace,
      12
    );
  });

  it('returns 0 for empty text and uses the word gap for a lone space', () => {
    expect(calculateDuration('', 20, 10)).toBe(0);
    expect(calculateDuration(' ', 20, 10)).toBeCloseTo(wordSpace, 12);
  });

  it('scales with the configured speeds', () => {
    const fast = getFarnsworthWpmSet(30, 15);
    // Same Farnsworth ratio, proportionally shorter character elements.
    expect(fast.charDot).toBeCloseTo(0.04, 12);
    expect(fast.letterSpace).toBeCloseTo(((60 / 15 - 0.04 * 31) / 19) * 3, 12);
    expect(calculateDuration('E', 30, 15)).toBeCloseTo(0.04, 12);
  });
});

describe('generateTimedLesson', () => {
  it('fills roughly the target duration with groups drawn from the lesson set', () => {
    // Fixed random source: every group is 'MMMMM', which takes 6.24 s with
    // its word gap at 20/10 WPM, so 60 s fits nine full groups plus a tenth.
    const text = generateTimedLesson(1, 60, 20, 10, null, () => 0.5);
    expect(text.length).toBeGreaterThan(0);
    for (const char of text) {
      expect('KM ').toContain(char);
    }
    const duration = calculateDuration(text, 20, 10);
    expect(duration).toBeGreaterThan(54);
    expect(duration).toBeLessThan(70);
  });

  it('is deterministic when Math.random is fixed (group size 2, char K)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const text = generateTimedLesson(1, 60, 20, 10);
    // group size = 2 + floor(0 * 6) = 2; char = lessonChars[0] = 'K'
    const groupDuration = calculateDuration('KK', 20, 10);
    const gap = calculateDuration(' ', 20, 10);
    const groups = Math.floor(60 / (groupDuration + gap));
    expect(text).toBe('KK '.repeat(groups));
  });

  it('is deterministic when Math.random is fixed (group size 5, char M)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const text = generateTimedLesson(1, 60, 20, 10);
    // group size = 2 + floor(0.5 * 6) = 5; char = 'KM'[floor(0.5 * 2)] = 'M'
    // 5 × 0.42 + 4 × letterSpace = 4.714736842105263, + gap 1.525263157894737 = 6.24
    // 60 / 6.24 = 9 full groups with a 3.84s remainder, so a 10th group fits.
    expect(text).toBe('MMMMM '.repeat(9) + 'MMMMM');
  });

  it('honours a fixed group size', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const text = generateTimedLesson(1, 12, 20, 10, 2);
    for (const group of text.trim().split(' ')) {
      expect(group.length).toBe(2);
    }
  });
});

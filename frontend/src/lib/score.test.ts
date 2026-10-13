import { describe, expect, it } from 'vitest';
import { SCORE_GOOD, SCORE_OK, diffWords, score, scoreGrade } from '$lib/score';

describe('scoreGrade', () => {
  it('maps accuracy to the shared grade thresholds', () => {
    expect(SCORE_GOOD).toBe(0.9);
    expect(SCORE_OK).toBe(0.7);
    expect(scoreGrade(1)).toBe('good');
    expect(scoreGrade(0.9)).toBe('good');
    expect(scoreGrade(0.89)).toBe('ok');
    expect(scoreGrade(0.7)).toBe('ok');
    expect(scoreGrade(0.69)).toBe('bad');
    expect(scoreGrade(0)).toBe('bad');
  });
});

describe('score (character error rate)', () => {
  it('returns 1 for an exact match, ignoring case', () => {
    expect(score('E K', 'e k')).toBe(1);
    expect(score('E K', 'E K')).toBe(1);
  });

  it('scores substitutions by edit distance over the reference', () => {
    // One of four characters changed -> 3/4 correct.
    expect(score('KMRU', 'KMRS')).toBeCloseTo(0.75, 10);
  });

  it('scores insertions by edit distance over the reference', () => {
    // One extra character in the input -> 1 edit over 3 reference characters.
    expect(score('KMR', 'KMSR')).toBeCloseTo(2 / 3, 10);
  });

  it('scores deletions by edit distance over the reference', () => {
    // One missing character from a four-character reference -> 3/4.
    expect(score('KMRU', 'KMU')).toBeCloseTo(0.75, 10);
  });

  it('normalizes case and whitespace before scoring', () => {
    expect(score('K M  R', 'k m r')).toBe(1);
    expect(score('  K M R  ', 'K M R')).toBe(1);
    expect(score('K M\nR', 'k  m\r\nr')).toBe(1);
  });

  it('scores empty input as 0 against a non-empty reference', () => {
    expect(score('K M R', '')).toBe(0);
    expect(score('K M R', '   ')).toBe(0);
  });

  it('never returns less than 0 for many wrong characters', () => {
    expect(score('KM', 'RU')).toBe(0);
  });
});

describe('diffWords', () => {
  it('marks every word correct for an exact match', () => {
    const tokens = diffWords('AB CD', 'ab cd');
    expect(tokens).toEqual([
      { ref: 'AB', inp: 'AB', type: 'correct' },
      { ref: 'CD', inp: 'CD', type: 'correct' }
    ]);
  });

  it('merges an adjacent missing + extra into a substitution', () => {
    const tokens = diffWords('AB CD', 'AB XY');
    expect(tokens).toEqual([
      { ref: 'AB', inp: 'AB', type: 'correct' },
      { ref: 'CD', inp: 'XY', type: 'substitution' }
    ]);
  });

  it('reports missing and extra words when counts differ', () => {
    const tokens = diffWords('AB CD EF', 'AB EF GH');
    expect(tokens.filter((token) => token.type === 'missing')).toEqual([
      { ref: 'CD', inp: '', type: 'missing' }
    ]);
    expect(tokens.filter((token) => token.type === 'extra')).toEqual([
      { ref: '', inp: 'GH', type: 'extra' }
    ]);
  });

  it('normalizes whitespace and empty input', () => {
    expect(diffWords('  AB   CD ', 'ab cd')).toHaveLength(2);
    expect(diffWords('AB CD', '')).toEqual([
      { ref: 'AB', inp: '', type: 'missing' },
      { ref: 'CD', inp: '', type: 'missing' }
    ]);
  });
});

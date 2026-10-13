import { describe, expect, it } from 'vitest';
import { calculateMedian } from './statistics';

describe('Median latency', () => {
  it('returns null for empty input', () => {
    expect(calculateMedian([])).toBeNull();
  });

  it('finds the middle of unsorted odd input without mutating it', () => {
    const latencies = Object.freeze([1200, 100, 350]);
    expect(calculateMedian(latencies)).toBe(350);
    expect(latencies).toEqual([1200, 100, 350]);
    expect(calculateMedian([1250])).toBe(1250);
  });

  it('averages the two middle values and rounds to integer milliseconds', () => {
    expect(calculateMedian([2000, 1000, 1201, 1200])).toBe(1201);
    expect(calculateMedian([2900, 2800])).toBe(2850);
  });
});

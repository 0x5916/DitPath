import { describe, expect, it } from 'vitest';
import {
  accuracyClass,
  formatClock,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatPercent,
  formatWeekday
} from './format';

describe('date formatting', () => {
  it('formats valid timestamps', () => {
    expect(formatDate('2026-09-17T12:00:00.000Z')).toContain('2026');
    expect(formatDateTime('2026-09-17T12:00:00.000Z')).toContain('2026');
  });

  it('renders missing or invalid timestamps as empty instead of throwing', () => {
    expect(formatDate()).toBe('');
    expect(formatDate('not-a-date')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatLongDate('not-a-date')).toBe('');
  });

  it('formats long dates and UTC weekdays', () => {
    expect(formatLongDate('2026-09-17T12:00:00.000Z')).toContain('2026');
    expect(formatWeekday(0)).toBeTruthy();
    expect(formatWeekday(6)).toBeTruthy();
    expect(formatWeekday(99)).toBe(formatWeekday(6));
  });
});

describe('number formatting', () => {
  it('formats ratios as rounded percentages', () => {
    expect(formatPercent(0.824)).toBe('82%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(Number.NaN)).toBe('');
  });
});

describe('clock and accuracy helpers', () => {
  it('formats seconds as a zero-padded clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(127)).toBe('2:07');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('maps accuracy to the shared score class', () => {
    expect(accuracyClass(0.95)).toBe('acc-good');
    expect(accuracyClass(0.8)).toBe('acc-ok');
    expect(accuracyClass(0.5)).toBe('acc-bad');
  });
});

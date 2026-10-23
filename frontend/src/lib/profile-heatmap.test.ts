import { describe, expect, it } from 'vitest';
import type { HistorySessionRecord } from './training/v2/types';
import {
  buildHeatmap,
  buildTrainingHabits,
  countSessionsForYear,
  getAvailableYears,
  progressRecordDays
} from './profile-heatmap';

describe('buildTrainingHabits', () => {
  const completed = (dates: string[]) =>
    dates.map((occurredAt) => ({ status: 'completed', occurredAt })) as HistorySessionRecord[];

  it('uses UTC dates, counts each active date once, and does not mutate history', () => {
    const records = completed([
      '2026-01-05T00:00:00Z',
      '2026-01-02T23:30:00-02:00',
      '2026-01-01T23:30:00-02:00',
      '2026-01-02T23:30:00+02:00'
    ]);
    const original = structuredClone(records);
    expect(buildTrainingHabits(records, 2026, Date.UTC(2026, 0, 6))).toEqual({
      activeDays: 3,
      longestStreak: 2,
      favoriteWeekday: 1
    });
    expect(records).toEqual(original);
  });

  it('excludes other years, future timestamps, invalid dates, and incomplete sessions', () => {
    const records = completed([
      '2025-12-31T23:59:59Z',
      '2026-01-01T00:00:00Z',
      '2026-01-02T00:00:00Z',
      '2026-01-05T12:00:01Z',
      '2026-01-06T00:00:00Z',
      '2027-01-01T00:00:00Z',
      'invalid'
    ]);
    records.push(
      { status: 'abandoned', occurredAt: '2026-01-03T00:00:00Z' } as HistorySessionRecord,
      { status: 'in-progress', occurredAt: '2026-01-04T00:00:00Z' } as HistorySessionRecord
    );
    expect(buildTrainingHabits(records, 2026, Date.UTC(2026, 0, 5, 12))).toEqual({
      activeDays: 2,
      longestStreak: 2,
      favoriteWeekday: 4
    });
    expect(buildTrainingHabits(records, 2024, Date.UTC(2026, 0, 2))).toEqual({
      activeDays: 0,
      longestStreak: 0,
      favoriteWeekday: null
    });
  });

  it('chooses the most frequent active weekday rather than session volume, Monday-first on ties', () => {
    const records = completed([
      ...Array<string>(5).fill('2026-01-04T00:00:00Z'),
      '2026-01-05T00:00:00Z',
      '2026-01-12T00:00:00Z',
      '2026-01-06T00:00:00Z',
      '2026-01-13T00:00:00Z'
    ]);
    expect(buildTrainingHabits(records, 2026, Date.UTC(2026, 0, 14))).toEqual({
      activeDays: 5,
      longestStreak: 3,
      favoriteWeekday: 1
    });
  });
});

describe('progressRecordDays', () => {
  it('counts completed sessions by UTC day and ignores unfinished or invalid records', () => {
    const records = [
      { status: 'completed', occurredAt: '2026-01-02T10:00:00.000Z' },
      { status: 'completed', completedAt: '2026-01-02T12:00:00.000Z' },
      { status: 'abandoned', occurredAt: '2026-01-03T10:00:00.000Z' },
      { status: 'completed', occurredAt: 'not-a-date' }
    ] as HistorySessionRecord[];

    expect(progressRecordDays(records)).toEqual([{ date: '2026-01-02', count: 2 }]);
  });
});

describe('getAvailableYears', () => {
  it('lists years from the current year back to the account creation year', () => {
    expect(getAvailableYears(Date.UTC(2024, 5, 1), 2026)).toEqual([2026, 2025, 2024]);
    expect(getAvailableYears(null, 2026)).toEqual([2026]);
  });
});

describe('countSessionsForYear', () => {
  it('adds only valid counts from the requested year', () => {
    const days = [
      { date: '2026-01-02', count: 2 },
      { date: '2026-12-31', count: 1 },
      { date: '2025-12-31', count: 9 },
      { date: 'invalid', count: 9 }
    ];

    expect(countSessionsForYear(days, 2026)).toBe(3);
  });
});

describe('buildHeatmap', () => {
  it('builds Monday-first weeks with bounded counts and locale labels', () => {
    const weeks = buildHeatmap(
      [
        { date: '2026-01-01', count: 2 },
        { date: '2026-01-02', count: 1 },
        { date: '2025-12-31', count: 9 }
      ],
      Date.UTC(2026, 0, 1),
      2026,
      { todayMs: Date.UTC(2026, 0, 10), formatMonth: () => 'M' }
    );

    expect(weeks).toHaveLength(53);
    expect(weeks[0].startMs).toBe(Date.UTC(2025, 11, 29));
    expect(weeks[0].monthLabel).toBe('M');
    expect(weeks[0].cells).toHaveLength(7);

    const outsideYear = weeks[0].cells[0];
    expect(outsideYear).toMatchObject({ outsideYear: true, count: 0, level: 0 });

    const jan1 = weeks[0].cells[3];
    expect(jan1).toMatchObject({
      dateMs: Date.UTC(2026, 0, 1),
      outsideYear: false,
      beforeAccount: false,
      inFuture: false,
      count: 2,
      level: 4
    });

    const jan2 = weeks[0].cells[4];
    expect(jan2).toMatchObject({ count: 1, level: 2 });

    const futureDay = weeks[1].cells[6];
    expect(futureDay).toMatchObject({ inFuture: true, count: 0, level: 0 });
  });

  it('ignores history before the account creation day', () => {
    const weeks = buildHeatmap([{ date: '2026-01-02', count: 5 }], Date.UTC(2026, 0, 3), 2026, {
      todayMs: Date.UTC(2026, 0, 10),
      formatMonth: () => 'M'
    });
    const jan2 = weeks[0].cells[4];

    expect(jan2).toMatchObject({ beforeAccount: true, count: 0, level: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import type { HistorySessionRecord } from './training/v2/types';
import {
  buildHeatmap,
  countSessionsForYear,
  getAvailableYears,
  progressRecordDays
} from './profile-heatmap';

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

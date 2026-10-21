/**
 * Profile activity-heatmap calculations.
 *
 * Pure UTC date math; the component owns locale labels and scrolling.
 */

import type { ProgressDay } from '#lib/api.ts';
import type { HistorySessionRecord } from '#lib/training/v2/types.ts';
import { sessionOccurredAt } from '#lib/training/v2/progress-summary.ts';

export const DAY_MS = 86_400_000;

export interface HeatmapCell {
  dateMs: number;
  dateKey: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  outsideYear: boolean;
  beforeAccount: boolean;
  inFuture: boolean;
}

export interface HeatmapWeek {
  startMs: number;
  monthLabel: string;
  cells: HeatmapCell[];
}

export interface HeatmapOptions {
  /** Reference day, normally today, in epoch milliseconds. */
  todayMs: number;
  /** Localized short month label. */
  formatMonth: (ms: number) => string;
}

const DAY_OF_MONTH_UTC_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  timeZone: 'UTC'
});

/** Count completed sessions per UTC day. */
export function progressRecordDays(items: HistorySessionRecord[]): ProgressDay[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.status !== 'completed') continue;
    const value = Date.parse(sessionOccurredAt(item));
    if (Number.isNaN(value)) continue;
    const date = new Date(value).toISOString().slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}

export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function mondayIndexFromDayNumber(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

function startOfWeekMondayMs(ms: number): number {
  const dayStart = utcDayStart(ms);
  const dayNumber = Math.floor(dayStart / DAY_MS);
  return dayStart - mondayIndexFromDayNumber(dayNumber) * DAY_MS;
}

function addDaysMs(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

function toDateKey(ms: number): string {
  return String(ms);
}

function monthLabelForWeek(
  weekStartMs: number,
  endMs: number,
  formatMonth: (ms: number) => string
): string {
  for (let offset = 0; offset < 7; offset += 1) {
    const dayMs = addDaysMs(weekStartMs, offset);
    if (dayMs > endMs) break;
    if (DAY_OF_MONTH_UTC_FORMATTER.format(dayMs) === '1') {
      return formatMonth(dayMs);
    }
  }

  return '';
}

function contributionLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (maxCount <= 1) return 4;
  const scaled = Math.ceil((count / maxCount) * 4);
  return Math.min(4, Math.max(1, scaled)) as 1 | 2 | 3 | 4;
}

/** Years the account has history for, newest first. */
export function getAvailableYears(createdAtMs: number | null, currentYear: number): number[] {
  const startYear = createdAtMs === null ? currentYear : new Date(createdAtMs).getFullYear();

  const years: number[] = [];
  for (let year = currentYear; year >= startYear; year -= 1) {
    years.push(year);
  }

  return years;
}

export function countSessionsForYear(items: ProgressDay[], year: number): number {
  let count = 0;
  for (const rec of items) {
    const parsedMs = Date.parse(rec.date);
    if (Number.isNaN(parsedMs)) continue;
    if (new Date(parsedMs).getUTCFullYear() === year) {
      count += rec.count;
    }
  }
  return count;
}

/**
 * Build Monday-first heatmap weeks for one year, ending at `options.todayMs`.
 * Days outside the year, before the account or in the future carry no count.
 */
export function buildHeatmap(
  items: ProgressDay[],
  createdAtMs: number | null,
  year: number,
  options: HeatmapOptions
): HeatmapWeek[] {
  const todayMs = utcDayStart(options.todayMs);
  const yearStartMs = utcDayStart(Date.UTC(year, 0, 1));
  const yearEndMs = utcDayStart(Date.UTC(year, 11, 31));
  const startWeekStartMs = startOfWeekMondayMs(yearStartMs);
  const endWeekStartMs = startOfWeekMondayMs(yearEndMs);
  const weekCount = Math.max(1, Math.floor((endWeekStartMs - startWeekStartMs) / (7 * DAY_MS)) + 1);

  const byDay: Record<string, number> = {};

  for (const rec of items) {
    const parsedMs = Date.parse(rec.date);
    if (Number.isNaN(parsedMs)) continue;

    const dayMs = utcDayStart(parsedMs);
    if (dayMs < yearStartMs || dayMs > yearEndMs) continue;
    if (createdAtMs !== null && dayMs < utcDayStart(createdAtMs)) continue;
    if (dayMs > todayMs) continue;

    const key = toDateKey(dayMs);
    byDay[key] = (byDay[key] ?? 0) + rec.count;
  }

  let maxCount = 0;
  for (const count of Object.values(byDay)) {
    if (count > maxCount) maxCount = count;
  }

  const weeks: HeatmapWeek[] = [];

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const weekStartMs = addDaysMs(startWeekStartMs, weekIndex * 7);
    const cells: HeatmapCell[] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dateMs = addDaysMs(weekStartMs, dayIndex);
      const dateKey = toDateKey(dateMs);
      const outsideYear = dateMs < yearStartMs || dateMs > yearEndMs;
      const beforeAccount = createdAtMs !== null && dateMs < utcDayStart(createdAtMs);
      const inFuture = dateMs > todayMs;
      const count = outsideYear || inFuture || beforeAccount ? 0 : (byDay[dateKey] ?? 0);

      cells.push({
        dateMs,
        dateKey,
        count,
        level: outsideYear || inFuture || beforeAccount ? 0 : contributionLevel(count, maxCount),
        outsideYear,
        beforeAccount,
        inFuture
      });
    }

    weeks.push({
      startMs: weekStartMs,
      monthLabel: monthLabelForWeek(weekStartMs, yearEndMs, options.formatMonth),
      cells
    });
  }

  if (weeks[0] && weeks[0].monthLabel === '') {
    weeks[0].monthLabel = options.formatMonth(weeks[0].startMs);
  }

  return weeks;
}

import { scoreGrade } from '#lib/score.ts';
import * as m from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const longDateFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const percentFormatters = new Map<string, Intl.NumberFormat>();

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const locale = getLocale();
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    cache.set(locale, formatter);
  }
  return formatter;
}

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format an ISO timestamp as a short local date, e.g. "Sep 17, 2026". */
export function formatDate(value?: string): string {
  if (!value) return '';
  const date = toDate(value);
  return date
    ? formatterFor(dateFormatters, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(date)
    : '';
}

/** Format a timestamp as a localized date and time; invalid values render as empty. */
export function formatDateTime(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return '';
  return formatterFor(dateTimeFormatters, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

/** Format a timestamp as a long localized date, e.g. "17 September 2026". */
export function formatLongDate(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return '';
  return formatterFor(longDateFormatters, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

/** Format a UTC weekday index (0 = Monday) using the current locale. */
export function formatWeekday(index: number): string {
  const safe = Number.isInteger(index) ? Math.min(Math.max(index, 0), 6) : 0;
  return formatterFor(weekdayFormatters, { weekday: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2024, 0, 7 + safe)
  );
}

/** Format a 0..1 ratio as a localized percentage, e.g. "82%". */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '';
  const locale = getLocale();
  let formatter = percentFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
    percentFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}

/** Display name for a forum author, falling back to a localized community label. */
export function authorLabel(author: { username?: string } | null | undefined): string {
  return author?.username ?? m.forum_community_member();
}

/** Format a duration in seconds as a clock readout, e.g. "2:07". */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${rest}`;
}

/** CSS modifier for an accuracy ratio (0..1). */
export function accuracyClass(value: number): string {
  return `acc-${scoreGrade(value)}`;
}

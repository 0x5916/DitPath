import { localizedHref } from '#lib/i18n.svelte.ts';
import { getLocale } from '#lib/paraglide/runtime.js';
import * as m from '#lib/paraglide/messages.js';

export const metrics = ['joined', 'learners', 'sessions', 'duration_ms'] as const;
export type Metric = (typeof metrics)[number];
export type Cohort = Metric | 'all';
export interface ReportPeriod {
  days: number;
  from: string;
  through: string;
  until: string;
}
export interface ReportTotals extends Record<Metric, number> {
  guided: number;
  practice: number;
  legacy: number;
  measured: number;
}
export interface OverviewReport {
  period: ReportPeriod;
  current: ReportTotals;
  previous: ReportTotals;
  daily: (ReportTotals & { day: string })[];
}
export interface DirectoryPosition {
  search: string;
  cursors: string[];
}
export const metricLabels = {
  joined: m.admin_joined,
  learners: m.admin_learners,
  sessions: m.admin_sessions,
  duration_ms: m.admin_duration
};

export function reportHref(
  view: 'overview' | 'users',
  days: number,
  until: string,
  metric: Cohort = 'all',
  learner?: string
) {
  const params = new URLSearchParams({ view, days: String(days) });
  if (until) params.set('until', until);
  if (metric !== 'all') params.set('metric', metric);
  if (learner) params.set('learner', learner);
  return `${localizedHref('/admin')}?${params}`;
}
export function reportDate(day: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeZone: 'Asia/Singapore'
  }).format(new Date(day));
}
export function rangeLabel(period: ReportPeriod) {
  return m.admin_dates({ from: reportDate(period.from), through: reportDate(period.through) });
}
export function duration(ms: number) {
  const seconds = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const unit = (n: number, u: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(getLocale(), { style: 'unit', unit: u, unitDisplay: 'short' }).format(n);
  if (hours) return `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`;
  return minutes ? unit(minutes, 'minute') : unit(seconds, 'second');
}
export function metricValue(metric: Metric, totals: ReportTotals) {
  if (metric === 'duration_ms')
    return totals.measured ? duration(totals.duration_ms) : m.progress_unmeasured();
  return new Intl.NumberFormat(getLocale()).format(totals[metric]);
}

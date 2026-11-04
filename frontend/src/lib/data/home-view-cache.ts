import type { HomeDashboard } from './home-dashboard';

/**
 * A short-lived, owner-scoped Home dashboard snapshot. It deliberately excludes
 * the learning projection and the resolved landing decision: recommendations,
 * coverage, due states and "no activity" must always be revalidated.
 */
export interface RetainedHomeView {
  owner: string;
  dashboard: HomeDashboard;
  recentReview: boolean;
  capturedAt: number;
}

/** Long enough for a normal lesson round-trip, short enough to bound stale summaries. */
export const HOME_VIEW_RETENTION_MS = 30 * 60_000;

let retained: RetainedHomeView | null = null;

export function retainHomeView(
  view: Omit<RetainedHomeView, 'capturedAt'>,
  now: number = Date.now()
): void {
  retained = { ...view, capturedAt: now };
}

export function readHomeView(owner: string, now: number = Date.now()): RetainedHomeView | null {
  if (!retained || retained.owner !== owner) return null;
  const age = now - retained.capturedAt;
  if (age < 0 || age > HOME_VIEW_RETENTION_MS) {
    retained = null;
    return null;
  }
  return retained;
}

/** Clear one owner's retained view, or every owner when omitted. */
export function clearHomeView(owner?: string): void {
  if (owner === undefined || retained?.owner === owner) retained = null;
}

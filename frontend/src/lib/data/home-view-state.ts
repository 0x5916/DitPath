export type HomeViewState = 'unresolved' | 'landing' | 'dashboard';
export type HomeRecommendationState = 'loading' | 'ready' | 'error';

export interface HomeResolutionInput {
  owner: string;
  dashboard: { hasActivity: boolean } | null;
  snapshot: { ownerKey: string; hasProspectiveEvidence: boolean } | null;
  loadError: boolean;
  learningFailed: boolean;
  /** The owner's first coverage read has not settled, so partial is not yet evidence. */
  coveragePending: boolean;
  /** The current projection was built after coverage initialized. */
  snapshotSettled: boolean;
  /** Only a previously resolved dashboard may be shown before revalidation. */
  retainedDashboard: boolean;
}

export interface HomeResolution {
  viewState: HomeViewState;
  recommendationState: HomeRecommendationState;
}

/**
 * Resolve Home without treating "not loaded" as "no activity". A retained
 * landing decision is never trusted; only a retained dashboard may bridge the
 * refresh. Recommendation actions wait for both owner-scoped inputs.
 */
export function resolveHomeView(input: HomeResolutionInput): HomeResolution {
  if (input.loadError || input.learningFailed)
    return { viewState: 'dashboard', recommendationState: 'error' };

  const snapshot = input.snapshot;
  if (!input.dashboard || !snapshot || snapshot.ownerKey !== input.owner)
    return {
      viewState: input.retainedDashboard ? 'dashboard' : 'unresolved',
      recommendationState: 'loading'
    };

  const hasDashboard =
    input.owner.startsWith('account:') ||
    input.dashboard.hasActivity ||
    snapshot.hasProspectiveEvidence;
  return {
    viewState: hasDashboard ? 'dashboard' : 'landing',
    // A partial projection is only actionable after the first sync settles.
    recommendationState: input.coveragePending || !input.snapshotSettled ? 'loading' : 'ready'
  };
}

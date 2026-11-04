import { describe, expect, it } from 'vitest';
import { resolveHomeView, type HomeResolutionInput } from './home-view-state';

const emptyDashboard = { hasActivity: false };
const activeDashboard = { hasActivity: true };
const emptySnapshot = { ownerKey: 'unclaimed', hasProspectiveEvidence: false };
const evidenceSnapshot = { ownerKey: 'unclaimed', hasProspectiveEvidence: true };

function input(overrides: Partial<HomeResolutionInput> = {}): HomeResolutionInput {
  return {
    owner: 'unclaimed',
    dashboard: emptyDashboard,
    snapshot: emptySnapshot,
    loadError: false,
    learningFailed: false,
    coveragePending: false,
    snapshotSettled: true,
    retainedDashboard: false,
    ...overrides
  };
}

describe('Home view resolution', () => {
  it('keeps an unresolved shell before either owner-scoped read finishes', () => {
    expect(resolveHomeView(input({ dashboard: null, snapshot: null }))).toEqual({
      viewState: 'unresolved',
      recommendationState: 'loading'
    });
  });

  it('resolves an empty guest to landing only after both reads finish', () => {
    expect(resolveHomeView(input())).toEqual({
      viewState: 'landing',
      recommendationState: 'ready'
    });
  });

  it('resolves returning and evidence-only activity to the dashboard', () => {
    expect(resolveHomeView(input({ dashboard: activeDashboard }))).toMatchObject({
      viewState: 'dashboard',
      recommendationState: 'ready'
    });
    expect(resolveHomeView(input({ snapshot: evidenceSnapshot }))).toMatchObject({
      viewState: 'dashboard',
      recommendationState: 'ready'
    });
  });

  it('revalidates a previously empty landing after activity appears elsewhere', () => {
    expect(resolveHomeView(input()).viewState).toBe('landing');
    expect(resolveHomeView(input({ dashboard: activeDashboard })).viewState).toBe('dashboard');
    expect(resolveHomeView(input({ snapshot: evidenceSnapshot })).viewState).toBe('dashboard');
  });

  it('only bridges the refresh with a retained dashboard, never a retained landing', () => {
    expect(
      resolveHomeView(input({ dashboard: null, snapshot: null, retainedDashboard: false }))
    ).toEqual({ viewState: 'unresolved', recommendationState: 'loading' });
    expect(
      resolveHomeView(input({ dashboard: null, snapshot: null, retainedDashboard: true }))
    ).toEqual({ viewState: 'dashboard', recommendationState: 'loading' });
  });

  it('keeps the recommendation non-actionable until first coverage settles', () => {
    expect(
      resolveHomeView(
        input({ snapshot: evidenceSnapshot, coveragePending: true, snapshotSettled: false })
      )
    ).toEqual({
      viewState: 'dashboard',
      recommendationState: 'loading'
    });
    expect(
      resolveHomeView(input({ dashboard: activeDashboard, coveragePending: true }))
    ).toMatchObject({
      viewState: 'dashboard',
      recommendationState: 'loading'
    });
  });

  it('does not trust a projection built before coverage initialized', () => {
    expect(
      resolveHomeView(input({ snapshot: evidenceSnapshot, snapshotSettled: false }))
    ).toMatchObject({
      viewState: 'dashboard',
      recommendationState: 'loading'
    });
  });

  it('allows settled partial coverage to become actionable', () => {
    expect(
      resolveHomeView(input({ snapshot: evidenceSnapshot, coveragePending: false }))
    ).toMatchObject({
      viewState: 'dashboard',
      recommendationState: 'ready'
    });
  });

  it('keeps a real load or projection failure visible while coverage is pending', () => {
    expect(resolveHomeView(input({ coveragePending: true, loadError: true }))).toEqual({
      viewState: 'dashboard',
      recommendationState: 'error'
    });
    expect(resolveHomeView(input({ coveragePending: true, learningFailed: true }))).toEqual({
      viewState: 'dashboard',
      recommendationState: 'error'
    });
  });

  it('does not reuse another owner’s snapshot', () => {
    expect(
      resolveHomeView(
        input({
          owner: 'account:b',
          snapshot: { ownerKey: 'account:a', hasProspectiveEvidence: true }
        })
      )
    ).toEqual({ viewState: 'unresolved', recommendationState: 'loading' });
  });

  it('exposes error recovery and returns to a ready recommendation after retry', () => {
    expect(resolveHomeView(input({ loadError: true }))).toEqual({
      viewState: 'dashboard',
      recommendationState: 'error'
    });
    expect(resolveHomeView(input({ learningFailed: true }))).toEqual({
      viewState: 'dashboard',
      recommendationState: 'error'
    });
    expect(resolveHomeView(input({ loadError: false, learningFailed: false }))).toEqual({
      viewState: 'landing',
      recommendationState: 'ready'
    });
  });
});

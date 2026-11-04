import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHomeView,
  HOME_VIEW_RETENTION_MS,
  readHomeView,
  retainHomeView
} from './home-view-cache';
import type { HomeDashboard } from './home-dashboard';

const dashboard = { hasActivity: true } as HomeDashboard;

afterEach(() => clearHomeView());

describe('Home retained view', () => {
  it('returns a retained dashboard only for the same owner', () => {
    retainHomeView({ owner: 'account:a', dashboard }, 1_000);
    expect(readHomeView('account:a', 1_000)).toMatchObject({
      owner: 'account:a',
      dashboard,
      capturedAt: 1_000
    });
    expect(readHomeView('account:b', 1_000)).toBeNull();
  });

  it('expires after the retention window and rejects a backwards clock', () => {
    retainHomeView({ owner: 'unclaimed', dashboard }, 1_000);
    expect(readHomeView('unclaimed', 1_000 + HOME_VIEW_RETENTION_MS)).not.toBeNull();
    expect(readHomeView('unclaimed', 1_000 + HOME_VIEW_RETENTION_MS + 1)).toBeNull();

    retainHomeView({ owner: 'unclaimed', dashboard }, 1_000);
    expect(readHomeView('unclaimed', 999)).toBeNull();
  });

  it('clears one owner without discarding another owner', () => {
    retainHomeView({ owner: 'account:a', dashboard }, 1_000);
    clearHomeView('account:b');
    expect(readHomeView('account:a', 1_000)).not.toBeNull();
    clearHomeView('account:a');
    expect(readHomeView('account:a', 1_000)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dismissMigrationBanner,
  isMigrationBannerDismissed,
  MIGRATION_BANNER_STORAGE_KEYS,
  resolveMigrationBanner,
  type MigrationBannerInput
} from './migration-banner';

const en = JSON.parse(
  readFileSync(new URL('../../messages/en.json', import.meta.url), 'utf8')
) as Record<string, string>;

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

const base: MigrationBannerInput = {
  signedIn: false,
  owner: 'unclaimed',
  contextLoaded: true,
  contextError: false,
  hasHistory: false,
  hasCheckpoints: false,
  hasUnimportedDeviceData: false,
  hasUnclaimedCheckpoints: false,
  training: { pending: 0, error: null, syncing: false, synced: false },
  learning: {
    pending: 0,
    rejected: 0,
    blocked: 0,
    error: null,
    syncing: false,
    synced: false,
    unavailable: false
  }
};

function input(overrides: Partial<MigrationBannerInput> = {}): MigrationBannerInput {
  return {
    ...base,
    ...overrides,
    training: { ...base.training, ...overrides.training },
    learning: { ...base.learning, ...overrides.learning }
  };
}

describe('migration banner state', () => {
  it('does nothing until local context is loaded', () => {
    expect(resolveMigrationBanner(input({ contextLoaded: false }))).toBeNull();
  });

  it('uses a short announcement for guests with no history', () => {
    expect(resolveMigrationBanner(base)).toMatchObject({
      kind: 'guest-empty',
      critical: false,
      tone: 'info'
    });
  });

  it('warns guests with browser-local history', () => {
    expect(resolveMigrationBanner(input({ hasHistory: true }))).toMatchObject({
      kind: 'guest-history',
      critical: true,
      tone: 'warning'
    });
  });

  it('warns guests with saved unfinished sessions even without completed history', () => {
    expect(resolveMigrationBanner(input({ hasCheckpoints: true }))).toMatchObject({
      kind: 'guest-history',
      showCheckpoint: true,
      critical: true
    });
  });

  it('uses a short announcement for signed-in users with no history', () => {
    expect(resolveMigrationBanner(input({ signedIn: true, owner: 'account:a' }))).toMatchObject({
      kind: 'signed-in-empty',
      critical: false,
      tone: 'info'
    });
  });

  it('directs signed-in users with history to verify sync status', () => {
    expect(
      resolveMigrationBanner(input({ signedIn: true, owner: 'account:a', hasHistory: true }))
    ).toMatchObject({
      kind: 'signed-in-ok',
      critical: false,
      tone: 'info'
    });
  });

  it('warns signed-in users about unimported device history and guest checkpoints', () => {
    expect(
      resolveMigrationBanner(
        input({
          signedIn: true,
          owner: 'account:a',
          hasUnimportedDeviceData: true,
          hasUnclaimedCheckpoints: true
        })
      )
    ).toMatchObject({
      kind: 'signed-in-unclaimed',
      critical: true,
      tone: 'warning'
    });
  });

  it('surfaces pending sync with a retry action', () => {
    expect(
      resolveMigrationBanner(
        input({
          signedIn: true,
          owner: 'account:a',
          training: { ...base.training, pending: 2 }
        })
      )
    ).toMatchObject({
      kind: 'sync-pending',
      critical: true,
      canRetry: true
    });
  });

  it('does not offer a duplicate retry while synchronization is running', () => {
    expect(
      resolveMigrationBanner(
        input({
          signedIn: true,
          owner: 'account:a',
          training: { ...base.training, pending: 2, syncing: true }
        })
      )
    ).toMatchObject({
      kind: 'sync-pending',
      canRetry: false
    });
  });

  it('surfaces failed or permanently rejected synchronization', () => {
    expect(
      resolveMigrationBanner(
        input({
          signedIn: true,
          owner: 'account:a',
          training: { ...base.training, pending: 1, error: 'TRAINING_SYNC_FAILED' }
        })
      )
    ).toMatchObject({
      kind: 'sync-failed',
      critical: true,
      tone: 'danger',
      canRetry: true
    });

    expect(
      resolveMigrationBanner(
        input({
          signedIn: true,
          owner: 'account:a',
          learning: { ...base.learning, rejected: 1 }
        })
      )
    ).toMatchObject({
      kind: 'sync-failed',
      critical: true,
      tone: 'danger',
      canRetry: false
    });
  });

  it('uses a conservative generic warning when local data cannot be read', () => {
    expect(resolveMigrationBanner(input({ contextError: true }))).toMatchObject({
      kind: 'unknown',
      critical: true,
      tone: 'warning'
    });
  });
});

describe('migration data-preservation messaging', () => {
  it('states the supported limits without promising automatic or checkpoint transfer', () => {
    expect(en.migration_guest_history_body).toContain('will not move automatically');
    expect(en.migration_guest_history_body).toContain('import this device’s history');
    expect(en.migration_checkpoint_body).toContain('not included in account import');
    expect(en.migration_unclaimed_body).toContain('unfinished sessions are not imported');
    expect(en.migration_signed_in_body).toContain('latest sessions show as synced');
    expect(en.migration_signed_in_empty_body).toContain('New progress will sync');
  });

  it('warns users not to clear browser data while sync is pending or failed', () => {
    expect(en.migration_sync_pending_body).toContain('do not clear site data');
    expect(en.migration_sync_failed_body).toContain('before moving or clearing browser data');
  });
});

describe('migration banner dismissal', () => {
  it('remembers non-critical announcements in local storage', () => {
    const state = resolveMigrationBanner(base)!;
    const storage = memoryStorage();

    expect(isMigrationBannerDismissed(state, storage)).toBe(false);
    dismissMigrationBanner(state, storage);
    expect(isMigrationBannerDismissed(state, storage)).toBe(true);
    expect(storage.getItem(MIGRATION_BANNER_STORAGE_KEYS.dismissed)).toBe('1');
  });

  it('keeps critical warnings session-dismissible by warning signature', () => {
    const pending = resolveMigrationBanner(
      input({
        signedIn: true,
        owner: 'account:a',
        training: { ...base.training, pending: 1 }
      })
    )!;
    const storage = memoryStorage();

    dismissMigrationBanner(pending, storage);
    expect(storage.getItem(MIGRATION_BANNER_STORAGE_KEYS.critical)).toBe(pending.signature);
    expect(isMigrationBannerDismissed(pending, storage)).toBe(true);

    const morePending = resolveMigrationBanner(
      input({
        signedIn: true,
        owner: 'account:a',
        training: { ...base.training, pending: 2 }
      })
    )!;
    expect(isMigrationBannerDismissed(morePending, storage)).toBe(false);
  });

  it('does not let a non-critical dismissal suppress a critical warning', () => {
    const info = resolveMigrationBanner(base)!;
    const critical = resolveMigrationBanner(
      input({
        signedIn: true,
        owner: 'account:a',
        training: { ...base.training, pending: 1 }
      })
    )!;
    const local = memoryStorage();
    const session = memoryStorage();

    dismissMigrationBanner(info, local);
    expect(isMigrationBannerDismissed(info, local)).toBe(true);
    expect(isMigrationBannerDismissed(critical, session)).toBe(false);
  });
});

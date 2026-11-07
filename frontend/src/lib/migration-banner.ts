export type MigrationBannerKind =
  | 'guest-empty'
  | 'guest-history'
  | 'signed-in-empty'
  | 'signed-in-ok'
  | 'signed-in-unclaimed'
  | 'sync-pending'
  | 'sync-failed'
  | 'unknown';

export interface MigrationBannerInput {
  signedIn: boolean;
  owner: string;
  contextLoaded: boolean;
  contextError: boolean;
  hasHistory: boolean;
  hasCheckpoints: boolean;
  hasUnimportedDeviceData: boolean;
  hasUnclaimedCheckpoints: boolean;
  training: {
    pending: number;
    error: string | null;
    syncing: boolean;
    synced: boolean;
  };
  learning: {
    pending: number;
    rejected: number;
    blocked: number;
    error: string | null;
    syncing: boolean;
    synced: boolean;
    unavailable: boolean;
  };
}

export interface MigrationBannerState {
  kind: MigrationBannerKind;
  critical: boolean;
  tone: 'info' | 'warning' | 'danger';
  showCheckpoint: boolean;
  canRetry: boolean;
  signature: string;
}

export const MIGRATION_BANNER_STORAGE_KEYS = {
  dismissed: 'ditpath.migration-banner.dismissed.v1',
  critical: 'ditpath.migration-banner.critical.v1'
} as const;

/**
 * Resolve the one announcement appropriate to the current account, local data,
 * and synchronization state. Critical states remain session-dismissible only.
 */
export function resolveMigrationBanner(input: MigrationBannerInput): MigrationBannerState | null {
  if (!input.contextLoaded) return null;

  const syncFailed =
    Boolean(input.training.error) ||
    input.learning.rejected > 0 ||
    input.learning.blocked > 0 ||
    Boolean(input.learning.error) ||
    input.learning.unavailable;
  const syncPending = input.training.pending > 0 || input.learning.pending > 0;
  const canRetry =
    !input.training.syncing &&
    !input.learning.syncing &&
    (input.training.pending > 0 || input.learning.pending > 0);

  let kind: MigrationBannerKind;
  if (input.signedIn) {
    if (syncFailed) kind = 'sync-failed';
    else if (syncPending) kind = 'sync-pending';
    else if (input.hasUnimportedDeviceData || input.hasUnclaimedCheckpoints)
      kind = 'signed-in-unclaimed';
    else if (input.hasHistory || input.hasCheckpoints) kind = 'signed-in-ok';
    else if (input.contextError) kind = 'unknown';
    else kind = 'signed-in-empty';
  } else if (input.contextError && !input.hasHistory && !input.hasCheckpoints) {
    kind = 'unknown';
  } else if (input.hasHistory || input.hasCheckpoints) {
    kind = 'guest-history';
  } else {
    kind = 'guest-empty';
  }

  const critical = [
    'guest-history',
    'signed-in-unclaimed',
    'sync-pending',
    'sync-failed',
    'unknown'
  ].includes(kind);
  const tone: MigrationBannerState['tone'] =
    kind === 'sync-failed' ? 'danger' : critical ? 'warning' : 'info';
  const showCheckpoint =
    (kind === 'guest-history' || kind === 'signed-in-ok') && input.hasCheckpoints;
  const signature = [
    input.owner,
    kind,
    input.training.pending,
    input.training.error ? 'training-error' : '',
    input.learning.pending,
    input.learning.rejected,
    input.learning.blocked,
    input.learning.unavailable ? 'learning-unavailable' : '',
    input.hasUnimportedDeviceData ? 'unimported' : '',
    input.hasCheckpoints ? 'checkpoints' : '',
    input.hasUnclaimedCheckpoints ? 'unclaimed-checkpoints' : ''
  ].join(':');

  return { kind, critical, tone, showCheckpoint, canRetry, signature };
}

export function migrationBannerStorageKey(state: MigrationBannerState): string {
  return state.critical
    ? MIGRATION_BANNER_STORAGE_KEYS.critical
    : MIGRATION_BANNER_STORAGE_KEYS.dismissed;
}

export function isMigrationBannerDismissed(
  state: MigrationBannerState,
  storage: Pick<Storage, 'getItem'> | null
): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem(migrationBannerStorageKey(state));
    return state.critical ? value === state.signature : value === '1';
  } catch {
    return false;
  }
}

export function dismissMigrationBanner(
  state: MigrationBannerState,
  storage: Pick<Storage, 'setItem'> | null
): void {
  if (!storage) return;
  try {
    storage.setItem(migrationBannerStorageKey(state), state.critical ? state.signature : '1');
  } catch {
    // Private browsing or blocked storage: the component also hides this
    // instance for the current page session.
  }
}

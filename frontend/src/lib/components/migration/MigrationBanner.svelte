<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { CircleAlert, CloudCheck, CloudUpload, HardDrive, Megaphone, X } from '@lucide/svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import {
    dismissMigrationBanner,
    isMigrationBannerDismissed,
    resolveMigrationBanner,
    type MigrationBannerInput,
    type MigrationBannerKind
  } from '#lib/migration-banner.ts';
  import {
    loadMigrationBannerContext,
    type MigrationBannerContext
  } from '#lib/migration-context.ts';
  import {
    learningSyncState,
    subscribeLearningSync,
    syncLearningNow
  } from '#lib/learning-sync.svelte.ts';
  import {
    getTrainingOwner,
    subscribeTrainingSync,
    syncTrainingNow,
    trainingSyncState
  } from '#lib/training-sync.svelte.ts';

  let mounted = $state(false);
  let context = $state.raw<MigrationBannerContext | null>(null);
  let refreshVersion = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  let locallyDismissed = $state<string | null>(null);
  let dismissalNonce = $state(0);
  let retrying = $state(false);

  const input = $derived.by<MigrationBannerInput>(() => {
    const current = context;
    return {
      signedIn: current?.signedIn ?? getTrainingOwner().startsWith('account:'),
      owner: current?.owner ?? getTrainingOwner(),
      contextLoaded: current !== null,
      contextError: current?.error ?? false,
      hasHistory: current?.hasHistory ?? false,
      hasCheckpoints: current?.hasCheckpoints ?? false,
      hasUnimportedDeviceData: current?.hasUnimportedDeviceData ?? false,
      hasUnclaimedCheckpoints: current?.hasUnclaimedCheckpoints ?? false,
      training: {
        pending: trainingSyncState.pending,
        error: trainingSyncState.error,
        syncing: trainingSyncState.syncing,
        synced: trainingSyncState.synced
      },
      learning: {
        pending: learningSyncState.pending,
        rejected: learningSyncState.rejected,
        blocked: learningSyncState.blocked,
        error: learningSyncState.error,
        syncing: learningSyncState.syncing,
        synced: learningSyncState.synced,
        unavailable: learningSyncState.unavailable
      }
    };
  });

  const bannerState = $derived(resolveMigrationBanner(input));

  const storage = $derived.by(() => {
    if (!bannerState) return null;
    try {
      return bannerState.critical ? sessionStorage : localStorage;
    } catch {
      return null;
    }
  });

  const dismissedInStorage = $derived.by(() => {
    void dismissalNonce;
    return bannerState ? isMigrationBannerDismissed(bannerState, storage) : false;
  });

  const visible = $derived(
    Boolean(
      mounted && bannerState && !dismissedInStorage && locallyDismissed !== bannerState.signature
    )
  );

  const showSyncDetails = $derived(Boolean(bannerState && bannerState.kind !== 'guest-empty'));
  const showRegister = $derived(
    Boolean(
      bannerState &&
      !input.signedIn &&
      bannerState.kind !== 'sync-pending' &&
      bannerState.kind !== 'sync-failed'
    )
  );
  const showFinishSaved = $derived(Boolean(bannerState?.showCheckpoint && context?.checkpointHref));
  const showRetry = $derived(
    Boolean(
      bannerState &&
      bannerState.canRetry &&
      (bannerState.kind === 'sync-pending' || bannerState.kind === 'sync-failed')
    )
  );

  function titleFor(kind: MigrationBannerKind): string {
    switch (kind) {
      case 'guest-history':
        return m.migration_guest_history_title();
      case 'signed-in-ok':
        return m.migration_signed_in_title();
      case 'signed-in-unclaimed':
        return m.migration_unclaimed_title();
      case 'sync-pending':
        return m.migration_sync_pending_title();
      case 'sync-failed':
        return m.migration_sync_failed_title();
      default:
        return m.migration_empty_title();
    }
  }

  function bodyFor(kind: MigrationBannerKind): string {
    switch (kind) {
      case 'guest-history':
        return m.migration_guest_history_body();
      case 'signed-in-empty':
        return m.migration_signed_in_empty_body();
      case 'signed-in-ok':
        return m.migration_signed_in_body();
      case 'signed-in-unclaimed':
        return m.migration_unclaimed_body();
      case 'sync-pending':
        return trainingSyncState.syncing || learningSyncState.syncing
          ? m.migration_sync_syncing_body()
          : m.migration_sync_pending_body();
      case 'sync-failed':
        return m.migration_sync_failed_body();
      case 'unknown':
        return m.migration_unknown_body();
      default:
        return m.migration_guest_empty_body();
    }
  }

  async function refresh(delay = 0) {
    clearTimeout(refreshTimer);
    if (delay > 0) {
      refreshTimer = setTimeout(() => void refresh(), delay);
      return;
    }
    const version = ++refreshVersion;
    try {
      const next = await loadMigrationBannerContext();
      if (!alive || version !== refreshVersion) return;
      context = next;
    } catch {
      if (!alive || version !== refreshVersion) return;
      const owner = getTrainingOwner();
      context = {
        owner,
        signedIn: owner.startsWith('account:'),
        hasHistory: false,
        hasCheckpoints: false,
        hasUnimportedDeviceData: false,
        hasUnclaimedCheckpoints: false,
        checkpointHref: null,
        error: true
      };
    }
  }

  function scheduleRefresh() {
    refresh(200);
  }

  function dismiss() {
    if (!bannerState) return;
    dismissMigrationBanner(bannerState, storage);
    locallyDismissed = bannerState.signature;
    dismissalNonce++;
  }

  async function retrySync() {
    if (retrying) return;
    retrying = true;
    try {
      await Promise.allSettled([syncTrainingNow(), syncLearningNow()]);
    } finally {
      retrying = false;
      void refresh();
    }
  }

  onMount(() => {
    mounted = true;
    void refresh();
    const stopTraining = subscribeTrainingSync(scheduleRefresh);
    const stopLearning = subscribeLearningSync(scheduleRefresh);
    return () => {
      alive = false;
      clearTimeout(refreshTimer);
      stopTraining();
      stopLearning();
    };
  });

  onDestroy(() => {
    alive = false;
    clearTimeout(refreshTimer);
  });
</script>

{#if visible && bannerState && context}
  <aside
    class="migration-banner"
    class:compact={bannerState.kind === 'guest-empty' || bannerState.kind === 'signed-in-empty'}
    class:warning={bannerState.tone === 'warning'}
    class:danger={bannerState.tone === 'danger'}
    role={bannerState.critical ? 'alert' : 'status'}
    aria-live={bannerState.critical ? 'assertive' : 'polite'}
    aria-labelledby="migration-banner-title"
    aria-describedby={bannerState.showCheckpoint
      ? 'migration-banner-body migration-banner-checkpoint'
      : 'migration-banner-body'}
  >
    <div class="migration-icon" aria-hidden="true">
      {#if bannerState.kind === 'sync-pending'}
        <CloudUpload size={20} />
      {:else if bannerState.kind === 'sync-failed'}
        <CircleAlert size={20} />
      {:else if bannerState.kind === 'signed-in-ok'}
        <CloudCheck size={20} />
      {:else if bannerState.kind === 'guest-history' || bannerState.kind === 'signed-in-unclaimed'}
        <HardDrive size={20} />
      {:else}
        <Megaphone size={20} />
      {/if}
    </div>

    <div class="migration-copy">
      <p class="migration-eyebrow">{m.migration_eyebrow()}</p>
      <h2 id="migration-banner-title">{titleFor(bannerState.kind)}</h2>
      {#if bannerState.kind === 'guest-empty'}
        <p id="migration-banner-body" class="migration-body">
          {m.migration_guest_empty_body()}
          <a class="link" href={localizedHref('/register')}>{m.migration_register_cta()}</a>
        </p>
      {:else if bannerState.kind === 'signed-in-empty'}
        <p id="migration-banner-body" class="migration-body">
          {m.migration_signed_in_empty_body()}
          <a class="link" href={`${localizedHref('/settings')}#sync-storage`}
            >{m.migration_sync_details_cta()}</a
          >
        </p>
      {:else}
        <p id="migration-banner-body" class="migration-body">{bodyFor(bannerState.kind)}</p>
        {#if bannerState.showCheckpoint}
          <p id="migration-banner-checkpoint" class="migration-body">
            {m.migration_checkpoint_body()}
          </p>
        {/if}

        <div class="migration-actions">
          {#if showRegister}
            <a
              class={showFinishSaved ? 'btn-ghost' : 'btn-primary'}
              href={localizedHref('/register')}
            >
              {m.migration_register_cta()}
            </a>
          {/if}
          {#if showRetry}
            <button
              type="button"
              class="btn-primary"
              disabled={retrying || trainingSyncState.syncing || learningSyncState.syncing}
              onclick={() => void retrySync()}
            >
              {m.migration_retry_sync_cta()}
            </button>
          {/if}
          {#if showFinishSaved && context.checkpointHref}
            <a class="btn-primary" href={localizedHref(context.checkpointHref)}>
              {m.migration_finish_saved_cta()}
            </a>
          {/if}
          {#if showSyncDetails}
            <a
              class={showRegister || showRetry || showFinishSaved ? 'btn-ghost' : 'btn-primary'}
              href={`${localizedHref('/settings')}#sync-storage`}
            >
              {m.migration_sync_details_cta()}
            </a>
          {/if}
        </div>
      {/if}
    </div>

    <button
      type="button"
      class="btn-icon migration-dismiss"
      aria-label={m.migration_dismiss()}
      title={m.migration_dismiss()}
      onclick={dismiss}
    >
      <X size={18} aria-hidden="true" />
    </button>
  </aside>
{/if}

<style>
  .migration-banner {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-3) var(--space-4);
    align-items: start;
    margin: 0 0 var(--section-gap);
    padding: var(--space-4) var(--space-10) var(--space-4) var(--space-4);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    background-color: var(--bg-surface);
    color: var(--text-primary);
  }

  .migration-banner.compact {
    gap: var(--space-3);
    padding-block: var(--space-3);
  }

  .migration-banner.compact .migration-icon {
    width: 2rem;
    height: 2rem;
  }

  .migration-banner.compact h2 {
    font-size: var(--text-base);
  }

  .migration-banner.compact .migration-body {
    margin-top: var(--space-1);
  }

  .migration-banner.warning {
    border-color: var(--status-ok);
    background-color: var(--status-ok-tint);
  }

  .migration-banner.danger {
    border-color: var(--status-bad);
    background-color: var(--status-bad-tint);
  }

  .migration-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    color: var(--accent);
  }

  .migration-banner.warning .migration-icon {
    color: var(--status-ok);
  }

  .migration-banner.danger .migration-icon {
    color: var(--status-bad);
  }

  .migration-copy {
    min-width: 0;
  }

  .migration-eyebrow {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    line-height: var(--leading-snug);
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    text-wrap: balance;
  }

  .migration-body {
    max-width: 70ch;
    margin: var(--space-2) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .migration-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .migration-dismiss {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 2.75rem;
    height: 2.75rem;
  }

  @media (max-width: 480px) {
    .migration-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .migration-actions :is(.btn-primary, .btn-ghost) {
      width: 100%;
    }
  }
</style>

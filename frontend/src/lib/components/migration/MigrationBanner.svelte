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

  const compact = $derived(
    bannerState?.kind === 'guest-empty' || bannerState?.kind === 'signed-in-empty'
  );
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

{#snippet recoveryLink()}
  <a
    class="link recovery-link standalone-target"
    href={`${localizedHref('/settings')}#device-recovery`}>{m.domain_recovery_title()}</a
  >
{/snippet}

{#if visible && bannerState && context}
  <aside
    class="migration-banner"
    class:compact
    class:warning={bannerState.tone === 'warning'}
    class:danger={bannerState.tone === 'danger'}
    role={bannerState.critical ? 'alert' : 'status'}
    aria-live={bannerState.critical ? 'assertive' : 'polite'}
    aria-labelledby="migration-banner-title"
    aria-describedby={bannerState.showCheckpoint
      ? 'migration-banner-body migration-banner-checkpoint'
      : 'migration-banner-body'}
  >
    <h2 id="migration-banner-title">
      {#if !compact}
        <span class="migration-icon" aria-hidden="true">
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
        </span>
      {/if}
      {titleFor(bannerState.kind)}
    </h2>

    <p id="migration-banner-body" class="migration-body">
      {bodyFor(bannerState.kind)}
      {#if showRegister && bannerState.kind !== 'guest-history'}
        <a class="link" href={localizedHref('/register')}>{m.migration_register_cta()}</a>
      {:else if compact}
        <a class="link" href={`${localizedHref('/settings')}#sync-storage`}
          >{m.migration_sync_details_cta()}</a
        >
      {/if}
      {#if compact}{@render recoveryLink()}{/if}
    </p>

    {#if bannerState.showCheckpoint}
      <p id="migration-banner-checkpoint" class="migration-body">{m.migration_checkpoint_body()}</p>
    {/if}
    {#if !compact}
      <div class="migration-actions">
        {#if showFinishSaved && context.checkpointHref}
          <a class="btn-primary" href={localizedHref(context.checkpointHref)}>
            {m.migration_finish_saved_cta()}
          </a>
        {/if}
        {#if showRetry}
          <button
            type="button"
            class="btn-primary"
            disabled={retrying || trainingSyncState.syncing || learningSyncState.syncing}
            onclick={retrySync}
          >
            {m.migration_retry_sync_cta()}
          </button>
        {/if}
        {#if bannerState.kind !== 'guest-history'}
          <a
            class={bannerState.critical && !showRetry && !showRegister
              ? 'btn-primary'
              : 'link standalone-target'}
            href={`${localizedHref('/settings')}#sync-storage`}>{m.migration_sync_details_cta()}</a
          >
        {/if}
        {@render recoveryLink()}
      </div>
    {/if}
    {#if bannerState.kind === 'guest-history'}
      <details class="migration-sync">
        <summary>{m.migration_guest_sync_heading()}</summary>
        <p class="migration-body">{m.migration_guest_sync_steps()}</p>
        <div class="migration-actions">
          <a class="link standalone-target" href={localizedHref('/register')}
            >{m.migration_register_cta()}</a
          >
          <a class="link standalone-target" href={`${localizedHref('/settings')}#sync-storage`}
            >{m.migration_sync_details_cta()}</a
          >
        </div>
      </details>
    {/if}

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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1) var(--space-2);
    margin: 0 0 var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .compact {
    padding: 0 0 var(--space-2);
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
  }

  .warning {
    --notice-accent: var(--status-ok);
    border-color: var(--notice-accent);
    background: var(--status-ok-tint);
  }

  .danger {
    --notice-accent: var(--status-bad);
    border-color: var(--notice-accent);
    background: var(--status-bad-tint);
  }

  h2 {
    grid-area: 1 / 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    line-height: var(--leading-snug);
  }

  .migration-icon {
    flex: none;
    color: var(--notice-accent, var(--accent));
  }

  .migration-body {
    grid-column: 1 / -1;
    max-width: 70ch;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .compact .migration-body {
    grid-column: 1;
    max-width: none;
  }

  .compact .recovery-link {
    margin-inline-start: var(--space-2);
  }
  @media (max-width: 480px) {
    .compact .recovery-link {
      display: flex;
      width: fit-content;
      margin-inline-start: 0;
    }
  }

  .migration-sync {
    grid-column: 1 / -1;
    font-size: var(--text-sm);
  }
  .migration-sync summary {
    width: fit-content;
    min-height: var(--nav-control-height);
    padding-block: var(--space-2);
    cursor: pointer;
    color: var(--text-secondary);
  }

  .migration-actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-4);
    font-size: var(--text-sm);
  }

  .migration-actions .link {
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .migration-dismiss {
    grid-area: 1 / 2;
    align-self: start;
    width: var(--nav-control-height);
    height: var(--nav-control-height);
  }

  .compact .migration-dismiss {
    grid-row: 1 / 3;
  }
</style>

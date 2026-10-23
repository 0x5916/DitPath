<script lang="ts">
  import { ChevronRight, CloudCheck, CloudUpload, HardDrive, CircleAlert } from '@lucide/svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  let {
    owner,
    pending,
    error,
    syncing,
    synced = false,
    expanded = false,
    onSync,
    onImport,
    unclaimedCount = 0,
    importing = false
  }: {
    owner: string;
    pending: number;
    error: string | null;
    syncing: boolean;
    synced?: boolean;
    expanded?: boolean;
    onSync?: () => void;
    onImport?: () => void;
    unclaimedCount?: number;
    importing?: boolean;
  } = $props();

  const needsAttention = $derived(
    owner !== 'unclaimed' && (Boolean(error) || (pending > 0 && !syncing))
  );
</script>

{#if expanded}
  <aside class="history-sync" aria-live="polite">
    <p class="sync-state">
      {#if owner === 'unclaimed'}
        <HardDrive size={16} aria-hidden="true" />{m.history_saved_device()}
      {:else if error}
        <CircleAlert size={16} aria-hidden="true" />{m.history_sync_error()}
      {:else if syncing}
        <CloudUpload size={16} aria-hidden="true" />{m.history_syncing()}
      {:else if pending > 0}
        <CloudUpload size={16} aria-hidden="true" />{m.history_sync_pending({ count: pending })}
      {:else if !synced}
        <HardDrive size={16} aria-hidden="true" />{m.history_saved_device()}
      {:else}
        <CloudCheck size={16} aria-hidden="true" />{m.history_synced()}
      {/if}
    </p>
    {#if owner !== 'unclaimed' && onSync}
      <button type="button" class="btn-ghost" disabled={syncing} onclick={onSync}
        >{m.history_sync_now()}</button
      >
    {/if}
    {#if owner !== 'unclaimed' && unclaimedCount > 0 && onImport}
      <p>{m.history_import_hint({ count: unclaimedCount })}</p>
      <button type="button" class="btn-ghost" disabled={importing} onclick={onImport}>
        {importing ? m.history_importing() : m.history_import()}
      </button>
    {/if}
  </aside>
{:else if needsAttention}
  <aside class="history-sync" aria-live="polite">
    <a class="sync-details" href={`${localizedHref('/settings')}#sync-storage`}>
      {#if error}
        <CircleAlert size={16} aria-hidden="true" />
        <span>{m.history_sync_attention()}</span>
      {:else}
        <CloudUpload size={16} aria-hidden="true" />
        <span>{m.history_sync_waiting({ count: pending })}</span>
      {/if}
      <ChevronRight size={16} aria-hidden="true" />
    </a>
  </aside>
{/if}

<style>
  .history-sync {
    width: 100%;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .sync-state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0;
  }
  p {
    line-height: var(--leading-normal);
  }
  .sync-details {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--answer-target-min);
    color: var(--text-secondary);
    text-decoration: none;
  }
  .sync-details span {
    flex: 1;
  }
  .sync-details :global(svg) {
    flex-shrink: 0;
  }
  .sync-details:hover {
    color: var(--accent);
  }
</style>

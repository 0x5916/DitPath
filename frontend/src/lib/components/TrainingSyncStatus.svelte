<script lang="ts">
  import { CloudCheck, CloudUpload, HardDrive, CircleAlert } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';

  let {
    owner,
    pending,
    error,
    syncing,
    synced = false,
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
    onSync?: () => void;
    onImport?: () => void;
    unclaimedCount?: number;
    importing?: boolean;
  } = $props();
</script>

<aside class="history-sync" aria-live="polite">
  <p class="sync-state">
    {#if owner === 'unclaimed'}
      <HardDrive size={16} aria-hidden="true" />{m.history_saved_device()}
    {:else if error}
      <CircleAlert size={16} aria-hidden="true" />{m.history_sync_error()}
    {:else if pending > 0}
      <CloudUpload size={16} aria-hidden="true" />{m.history_sync_pending({ count: pending })}
    {:else if syncing}
      <CloudUpload size={16} aria-hidden="true" />{m.history_syncing()}
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
</style>

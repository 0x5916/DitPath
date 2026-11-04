<script lang="ts">
  import { ChevronRight, CloudCheck, CloudUpload, HardDrive, CircleAlert } from '@lucide/svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  let {
    owner,
    pending,
    rejected = 0,
    blocked = 0,
    error,
    syncing,
    synced = false,
    expanded = false,
    scope = 'training',
    onSync,
    onImport,
    unclaimedCount = 0,
    importing = false
  }: {
    owner: string;
    pending: number;
    /** Permanently rejected records retained locally for diagnosis. */
    rejected?: number;
    /** Pending records whose permanently rejected dependency blocks upload. */
    blocked?: number;
    error: string | null;
    syncing: boolean;
    synced?: boolean;
    expanded?: boolean;
    /** Keep the independent training and learning-evidence statuses named apart. */
    scope?: 'training' | 'evidence';
    onSync?: () => void;
    onImport?: () => void;
    unclaimedCount?: number;
    importing?: boolean;
  } = $props();

  const needsAttention = $derived(
    owner !== 'unclaimed' &&
      (Boolean(error) || rejected > 0 || blocked > 0 || (pending > 0 && !syncing))
  );
  const saved = $derived(
    scope === 'evidence' ? m.evidence_saved_device() : m.history_saved_device()
  );
  const syncingText = $derived(scope === 'evidence' ? m.evidence_syncing() : m.history_syncing());
  const syncedText = $derived(scope === 'evidence' ? m.evidence_synced() : m.history_synced());
  const errorText = $derived(
    scope === 'evidence' ? m.evidence_sync_error() : m.history_sync_error()
  );
  const pendingText = $derived(
    scope === 'evidence'
      ? m.evidence_sync_pending({ count: pending })
      : m.history_sync_pending({ count: pending })
  );
  const rejectedText = $derived(
    scope === 'evidence'
      ? m.evidence_sync_rejected({ count: rejected })
      : m.history_sync_rejected({ count: rejected })
  );
  const blockedText = $derived(
    scope === 'evidence'
      ? m.evidence_sync_blocked({ count: blocked })
      : m.history_sync_blocked({ count: blocked })
  );
  const attentionText = $derived(
    scope === 'evidence' ? m.evidence_sync_attention() : m.history_sync_attention()
  );
  const waitingText = $derived(
    scope === 'evidence'
      ? m.evidence_sync_waiting({ count: pending })
      : m.history_sync_waiting({ count: pending })
  );
  const detailsHref = $derived(
    `${localizedHref('/settings')}#${scope === 'evidence' ? 'learning-evidence' : 'sync-storage'}`
  );
</script>

{#if expanded}
  <aside class="history-sync" aria-live="polite">
    {#if owner === 'unclaimed'}
      <p class="sync-state">
        <HardDrive size={16} aria-hidden="true" />{saved}
      </p>
    {:else if error}
      <p class="sync-state">
        <CircleAlert size={16} aria-hidden="true" />{errorText}
      </p>
    {:else if syncing}
      <p class="sync-state">
        <CloudUpload size={16} aria-hidden="true" />{syncingText}
      </p>
    {:else if pending > 0 || rejected > 0 || blocked > 0}
      <ul class="sync-state sync-issues">
        {#if pending > 0}<li>
            <CloudUpload size={16} aria-hidden="true" />{pendingText}
          </li>{/if}
        {#if rejected > 0}<li>
            <CircleAlert size={16} aria-hidden="true" />{rejectedText}
          </li>{/if}
        {#if blocked > 0}<li>
            <CircleAlert size={16} aria-hidden="true" />{blockedText}
          </li>{/if}
      </ul>
    {:else if !synced}
      <p class="sync-state">
        <HardDrive size={16} aria-hidden="true" />{saved}
      </p>
    {:else}
      <p class="sync-state">
        <CloudCheck size={16} aria-hidden="true" />{syncedText}
      </p>
    {/if}
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
  <!-- Routine background sync stays discoverable without interrupting assessed audio. -->
  <aside class="history-sync">
    <a class="sync-details" href={detailsHref}>
      {#if error || rejected > 0 || blocked > 0}
        <CircleAlert size={16} aria-hidden="true" />
        <span>{attentionText}</span>
      {:else}
        <CloudUpload size={16} aria-hidden="true" />
        <span>{waitingText}</span>
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
  .sync-issues {
    display: grid;
    list-style: none;
    padding: 0;
  }
  .sync-issues li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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

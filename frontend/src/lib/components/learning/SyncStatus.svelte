<script lang="ts">
  import { Cloud, CloudOff, RefreshCw, Check, AlertCircle } from '@lucide/svelte';

  export type SyncState =
    'local-only' | 'pending' | 'syncing' | 'synced' | 'auth-required' | 'error';

  interface Props {
    status: SyncState;
    pendingCount?: number;
    onRetry?: () => void;
  }

  let { status = 'synced', pendingCount = 0, onRetry = () => {} }: Props = $props();
</script>

<div class="sync-status-indicator" role="status" aria-label={`Sync status: ${status}`}>
  {#if status === 'synced'}
    <span class="status-item text-muted">
      <span class="status-icon text-good"><Check size={14} /></span>
      <span>Synced</span>
    </span>
  {:else if status === 'syncing'}
    <span class="status-item text-muted">
      <span class="status-icon spin-icon"><RefreshCw size={14} /></span>
      <span>Syncing…</span>
    </span>
  {:else if status === 'pending'}
    <span class="status-item text-muted">
      <Cloud size={14} class="status-icon" />
      <span>Saved locally ({pendingCount})</span>
    </span>
  {:else if status === 'local-only'}
    <span class="status-item text-muted">
      <CloudOff size={14} class="status-icon" />
      <span>Saved on this device</span>
    </span>
  {:else if status === 'error'}
    <button type="button" class="status-btn text-bad" onclick={onRetry} title="Click to retry sync">
      <AlertCircle size={14} class="status-icon" />
      <span>Sync failed · Retry</span>
    </button>
  {:else if status === 'auth-required'}
    <span class="status-item text-muted">
      <Cloud size={14} class="status-icon" />
      <span>Sign in to sync</span>
    </span>
  {/if}
</div>

<style>
  .sync-status-indicator {
    display: inline-flex;
    align-items: center;
    font-size: var(--text-xs);
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
  }

  .status-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: var(--text-xs);
  }

  .text-good {
    color: var(--learning-stable, var(--status-good));
  }

  .text-bad {
    color: var(--learning-error, var(--status-bad));
  }

  .text-muted {
    color: var(--text-muted);
  }

  .spin-icon {
    animation: spin 1.5s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin-icon {
      animation: none;
    }
  }
</style>

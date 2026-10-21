<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { openTrainingDb, closeTrainingDb, clearTrainingCache } from '#lib/data/training-db.ts';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import { Trash2 } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';

  const sessionScope = createSessionScope();
  const timers = new SvelteSet<ReturnType<typeof setTimeout>>();
  let destroyed = false;

  onDestroy(() => {
    destroyed = true;
    sessionScope.dispose();
    for (const timer of timers) clearTimeout(timer);
  });

  function later(callback: () => void, delay: number): void {
    const current = sessionScope.capture();
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (current()) callback();
    }, delay);
    timers.add(timer);
  }

  let confirmClearOpen = $state(false);
  let clearSuccess = $state(false);
  let clearing = $state(false);
  let clearError = $state('');

  async function handleClearLocalData() {
    if (clearing) return;
    clearing = true;
    clearSuccess = false;
    clearError = '';
    try {
      const db = await openTrainingDb();
      try {
        await clearTrainingCache(db);
      } finally {
        closeTrainingDb(db);
      }
      if (destroyed) return;
      confirmClearOpen = false;
      clearSuccess = true;
      later(() => (clearSuccess = false), 3000);
    } catch (error) {
      if (!destroyed)
        clearError =
          error instanceof Error &&
          error.message === 'Pending training uploads must be synchronized before clearing history'
            ? m.history_clear_pending()
            : m.settings_data_error();
    } finally {
      if (!destroyed) clearing = false;
    }
  }
</script>

<section class="panel panel--ledger">
  <h2 class="card-title">{m.settings_data_title()}</h2>
  <div class="settings-form">
    <p class="field-hint">{m.settings_data_description()}</p>

    <div class="data-actions-row">
      <button
        type="button"
        class="btn-ghost text-danger"
        disabled={clearing}
        aria-expanded={confirmClearOpen}
        aria-controls="confirm-clear-data"
        onclick={() => {
          clearError = '';
          confirmClearOpen = true;
        }}
      >
        <Trash2 size={16} />
        <span>{m.settings_data_clear()}</span>
      </button>
      {#if clearSuccess}
        <span class="clear-success-label" role="status">{m.settings_data_cleared()}</span>
      {/if}
    </div>

    {#if confirmClearOpen}
      <div
        id="confirm-clear-data"
        class="confirm-clear-box"
        role="group"
        aria-labelledby="confirm-clear-title"
        aria-busy={clearing}
      >
        <p id="confirm-clear-title" class="confirm-clear-text">{m.settings_data_confirm()}</p>
        {#if clearError}
          <ErrorAlert message={clearError} />
        {/if}
        <div class="confirm-actions">
          <button
            type="button"
            class="btn-primary"
            disabled={clearing}
            onclick={handleClearLocalData}
          >
            {clearing ? m.common_loading() : m.settings_data_delete()}
          </button>
          <button
            type="button"
            class="btn-ghost"
            disabled={clearing}
            onclick={() => (confirmClearOpen = false)}
          >
            {m.forum_cancel()}
          </button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .data-actions-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-2);
  }

  .text-danger {
    color: var(--danger);
  }

  .clear-success-label {
    font-size: var(--text-xs);
    color: var(--status-good);
  }

  .confirm-clear-box {
    margin-top: var(--space-3);
    padding: var(--space-4);
    background-color: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .confirm-clear-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-3);
  }
</style>

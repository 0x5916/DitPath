<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, searchAdminUsers } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import {
    duration,
    metricLabels,
    rangeLabel,
    reportDate,
    reportHref,
    type Cohort,
    type DirectoryPosition,
    type ReportPeriod
  } from '#lib/admin-report.ts';
  import * as m from '#lib/paraglide/messages.js';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  let {
    onDenied,
    onPeriod,
    days,
    until,
    metric,
    position
  }: {
    onPeriod: (until: string) => void;
    onDenied: (status: number) => void;
    days: number;
    until: string;
    metric: Cohort;
    position: DirectoryPosition;
  } = $props();
  let period = $state<ReportPeriod | null>(null);
  const scope = createSessionScope();
  let draft = $state(''),
    search = $state('');
  let cursors = $state<string[]>([]);
  let accounts = $state.raw<Awaited<ReturnType<typeof searchAdminUsers>>['data']>([]);
  let next = $state<string | null>(null);
  let loadState = $state<'loading' | 'ready' | 'error'>('loading');
  async function load() {
    const current = scope.begin();
    position.search = search;
    position.cursors = [...cursors];
    loadState = 'loading';
    try {
      const result = await searchAdminUsers(search, days, until, metric, cursors.at(-1));
      if (!current()) return;
      onPeriod(result.period.until);
      period = result.period;
      accounts = result.data;
      next = result.next_cursor;
      loadState = 'ready';
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && [401, 403].includes(e.status)) onDenied(e.status);
      else loadState = 'error';
    }
  }
  function submit(value: string) {
    draft = search = value.trim();
    cursors = [];
    void load();
  }
  onMount(() => {
    draft = search = position.search;
    cursors = [...position.cursors];
    void load();
  });
  onDestroy(scope.dispose);
</script>

<section class="page-stack">
  <h2 class="card-title">{m.admin_directory()}</h2>
  {#if period && metric !== 'all'}<p>
      {metricLabels[metric]()} · {rangeLabel(period)}
      <a href={reportHref('users', days, until)}>{m.admin_clear()}</a>
    </p>{/if}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      submit(draft);
    }}
  >
    <label for="user-search">{m.admin_search_label()}</label>
    <div class="actions">
      <input id="user-search" type="search" maxlength="254" bind:value={draft} />
      <button class="btn-primary">{m.admin_search()}</button>
      {#if draft || search}<button type="button" class="btn-ghost" onclick={() => submit('')}
          >{m.admin_clear()}</button
        >{/if}
    </div>
  </form>
  {#if loadState === 'loading'}<LoadingSpinner />
  {:else if loadState === 'error'}<ErrorAlert message={m.common_load_error()} /><button
      class="btn-ghost"
      onclick={load}>{m.common_retry()}</button
    >
  {:else if accounts.length === 0}<p role="status">
      {search ? m.admin_no_matches() : m.admin_empty()}
    </p>
  {:else}
    <ul class="records">
      {#each accounts as account (account.id)}
        <li>
          <a href={reportHref('users', days, until, metric, account.id)}
            ><strong>{account.username}</strong></a
          > <span>{account.call_sign ?? ''}</span>
          <div>
            {account.email} · {account.email_verified
              ? m.profile_email_status_verified()
              : m.profile_email_status_not_verified()}
          </div>
          {#if metric === 'sessions' || metric === 'learners'}<div>
              {m.admin_sessions()} · {account.sessions}
            </div>
          {:else if metric === 'duration_ms'}<div>
              {m.admin_duration()} · {duration(account.duration_ms)}
            </div>{/if}
          <small>{m.profile_member_since()} · {reportDate(account.created_at)}</small>
        </li>
      {/each}
    </ul>
  {/if}
  {#if loadState === 'ready' && (cursors.length || next)}
    <div class="actions">
      <button
        class="btn-ghost"
        disabled={!cursors.length}
        onclick={() => {
          cursors.pop();
          void load();
        }}>{m.admin_previous()}</button
      >
      <button
        class="btn-ghost"
        disabled={!next}
        onclick={() => {
          if (next) cursors.push(next);
          void load();
        }}>{m.admin_next()}</button
      >
    </div>
  {/if}
</section>

<style>
  .records {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .records li {
    border-bottom: 1px solid var(--border);
    padding: var(--space-3) 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  label {
    display: block;
    margin-bottom: var(--space-1);
  }
  input {
    max-width: 100%;
    min-height: 44px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    background: var(--bg-surface);
    color: inherit;
  }
</style>

<script lang="ts">
  import { ChevronRight, Mail, Search } from '@lucide/svelte';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { ApiError, searchAdminUsers } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import {
    duration,
    metricLabels,
    reportDate,
    reportHref,
    type Cohort,
    type DirectoryPosition,
    type ReportPeriod
  } from '#lib/admin-report.ts';
  import * as m from '#lib/paraglide/messages.js';
  import SelectedRecipients from './SelectedRecipients.svelte';
  import { getAdminMailSession, recipientLimit } from '#lib/admin-mail.svelte.ts';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  let {
    reportHeader,
    onDenied,
    onPeriod,
    days,
    until,
    metric,
    position
  }: {
    reportHeader: Snippet<[string, ReportPeriod | null]>;
    onPeriod: (until: string) => void;
    onDenied: (status: number) => void;
    days: number;
    until: string;
    metric: Cohort;
    position: DirectoryPosition;
  } = $props();
  let period = $state<ReportPeriod | null>(null);
  const mail = getAdminMailSession();
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
  {@render reportHeader(m.admin_directory(), period)}
  <form
    class="field"
    onsubmit={(e) => {
      e.preventDefault();
      submit(draft);
    }}
  >
    <label class="label-text" for="user-search">{m.admin_search_label()}</label>
    <div class="actions">
      <input class="input" id="user-search" type="search" maxlength="254" bind:value={draft} />
      <button class="btn-primary"><Search size={16} aria-hidden="true" />{m.admin_search()}</button>
      {#if draft || search}<button type="button" class="btn-ghost" onclick={() => submit('')}
          >{m.admin_clear()}</button
        >{/if}
    </div>
    {#if metric !== 'all'}<div class="actions filter">
        <span class="chip">{metricLabels[metric]()}</span>
        <a class="link" href={reportHref('users', days, until)}>{m.admin_clear()}</a>
      </div>{/if}
  </form>
  <SelectedRecipients>
    {#if mail.draft.recipients.length}<a
        class="btn-ghost"
        href={reportHref('compose', days, until, metric)}
      >
        <Mail size={16} aria-hidden="true" />{m.mail_compose()}</a
      >{/if}
  </SelectedRecipients>
  {#if loadState === 'loading'}<LoadingSpinner />
  {:else if loadState === 'error'}<ErrorAlert message={m.common_load_error()} /><button
      class="btn-ghost"
      onclick={load}>{m.common_retry()}</button
    >
  {:else if accounts.length === 0}<p class="body-text" role="status">
      {search ? m.admin_no_matches() : m.admin_empty()}
    </p>
  {:else}
    <ul class="row-list records" role="list">
      {#each accounts as account (account.id)}
        {@const selected = mail.draft.recipients.some((r) => r.id === account.id)}
        <li>
          <label class="pick"
            ><input
              type="checkbox"
              aria-label={m.mail_select({ name: account.username })}
              checked={selected}
              disabled={!!mail.draft.pending ||
                (!selected && mail.draft.recipients.length >= recipientLimit)}
              onchange={() => mail.draft.toggle(account)}
            /></label
          >
          <a
            class="row-link account"
            aria-labelledby={'name-' + account.id}
            aria-describedby={'email-' + account.id + ' facts-' + account.id}
            href={reportHref('users', days, until, metric, account.id)}
          >
            <div>
              <div class="identity">
                <strong id={'name-' + account.id}>{account.username}</strong>
                {#if account.call_sign}<span class="callsign">{account.call_sign}</span>{/if}
              </div>
              <div class="body-text" id={'email-' + account.id}>{account.email}</div>
              <div class="meta-row">
                {account.email_verified
                  ? m.profile_email_status_verified()
                  : m.profile_email_status_not_verified()}
              </div>
            </div>
            <div class="facts" id={'facts-' + account.id}>
              {#if metric === 'sessions' || metric === 'learners'}
                <p>{m.admin_sessions()} · <strong>{account.sessions}</strong></p>
              {:else if metric === 'duration_ms'}
                <p>{m.admin_duration()} · <strong>{duration(account.duration_ms)}</strong></p>
              {/if}
              <p class="meta-row">{m.profile_member_since()} · {reportDate(account.created_at)}</p>
            </div>
            <ChevronRight size={16} aria-hidden="true" />
          </a>
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
  .actions,
  .identity {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .actions .input {
    flex: 1 1 14rem;
    min-width: 0;
    max-width: 30rem;
  }
  .filter {
    font-size: var(--text-sm);
  }
  .records li {
    display: grid;
    grid-template-columns: var(--answer-target-min) minmax(0, 1fr);
    align-items: center;
    border-top: 1px solid var(--border);
  }
  .pick {
    display: grid;
    place-items: center;
    min-height: var(--answer-target-min);
    cursor: pointer;
  }
  .pick input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .account {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-3);
    overflow-wrap: anywhere;
  }
  .callsign,
  .facts {
    font-size: var(--text-sm);
  }
  .facts {
    display: grid;
    gap: var(--space-1);
  }
  .account :global(svg) {
    color: var(--text-muted);
  }
  @media (max-width: 639px) {
    .account {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
    }
    .facts {
      grid-column: 1;
    }
    .account :global(svg) {
      grid-column: 2;
      grid-row: 1 / span 2;
    }
  }
</style>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    ApiError,
    getSentMessage,
    getSentMessages,
    type SentMessage,
    type SentMessageSummary
  } from '#lib/api.ts';
  import { mailReason, mailError, topicLabels } from '#lib/admin-mail.svelte.ts';
  import { reportHref, type Cohort } from '#lib/admin-report.ts';
  import { formatDateTime } from '#lib/format.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import * as m from '#lib/paraglide/messages.js';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  let {
    id,
    days,
    until,
    metric,
    onDenied
  }: {
    id: string;
    days: number;
    until: string;
    metric: Cohort;
    onDenied: (status: number) => void;
  } = $props();
  const scope = createSessionScope();
  const statuses = {
    queued: m.mail_queued,
    sending: m.mail_sending,
    accepted: m.mail_accepted,
    skipped: m.mail_skipped,
    failed: m.mail_failed,
    unknown: m.mail_unknown
  };
  let list = $state.raw<SentMessageSummary[]>([]);
  let message = $state.raw<SentMessage | null>(null);
  let cursors = $state<string[]>([]),
    next = $state<string | null>(null);
  let loading = $state(true),
    error = $state('');
  let errorBox = $state<HTMLDivElement>();
  async function load() {
    const current = scope.begin();
    loading = true;
    error = '';
    try {
      if (id) {
        const result = await getSentMessage(id);
        if (current()) message = result;
      } else {
        const result = await getSentMessages(cursors.at(-1));
        if (current()) {
          list = result.data;
          next = result.next_cursor;
        }
      }
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        onDenied(e.status);
        return;
      }
      error = mailError(e);
      await tick();
      if (current()) errorBox?.focus();
    } finally {
      if (current()) loading = false;
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(scope.dispose);
</script>

<section class="page-stack">
  <h2 class="card-title">{message ? message.subject : m.mail_sent()}</h2>
  {#if error}<div tabindex="-1" bind:this={errorBox}><ErrorAlert message={error} /></div>
    <button class="btn-ghost" onclick={load}>{m.common_retry()}</button>
  {:else if loading}<LoadingSpinner />
  {:else if message}
    <p>
      {topicLabels[message.topic]()} ·
      <time datetime={message.created_at}>{formatDateTime(message.created_at)}</time>
    </p>
    <dl>
      <dt>{m.mail_from()}</dt>
      <dd>{message.from}</dd>
      <dt>{m.mail_reply()}</dt>
      <dd>{message.reply_to}</dd>
    </dl>
    <div class="panel">
      <p class="copy">{message.body}</p>
      <p class="copy">{message.footer}</p>
      <p>{m.mail_unsubscribe()}</p>
    </div>
    <h3>{m.mail_recipients()}</h3>
    <ul>
      {#each message.recipients as r (r.id)}<li>
          <strong>{r.username || m.mail_unavailable()}</strong>
          {r.email}
          <div>{statuses[r.status]()} {r.reason ? mailReason(r.reason) : ''}</div>
        </li>{/each}
    </ul>
    <div class="actions"><button class="btn-ghost" onclick={load}>{m.mail_refresh()}</button></div>
  {:else if !list.length}<p role="status">{m.mail_no_sent()}</p>
  {:else}
    <ul>
      {#each list as item (item.id)}<li>
          <a href={reportHref('sent', days, until, metric, undefined, item.id)}
            ><strong>{item.subject}</strong></a
          >
          <div>
            {topicLabels[item.topic]()} ·
            <time datetime={item.created_at}>{formatDateTime(item.created_at)}</time>
          </div>
        </li>{/each}
    </ul>
    {#if cursors.length || next}<div class="actions">
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
      </div>{/if}
  {/if}
</section>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .copy {
    white-space: pre-wrap;
  }
  section {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  ul,
  dl,
  dd {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  dt {
    color: var(--text-muted);
  }
  li {
    border-block-end: 1px solid var(--border);
    padding-block: var(--space-2);
  }
</style>

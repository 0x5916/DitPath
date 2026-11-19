<script lang="ts">
  import {
    Clock,
    Send,
    CircleMinus,
    CircleAlert,
    CircleHelp,
    ChevronRight,
    RefreshCw
  } from '@lucide/svelte';
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
  import MailLetter from './MailLetter.svelte';
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
  const statusIcons = {
    queued: Clock,
    sending: Send,
    accepted: Send,
    skipped: CircleMinus,
    failed: CircleAlert,
    unknown: CircleHelp
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

<section class="page-stack history">
  <h2 class="section-title">{message ? message.subject : m.mail_sent()}</h2>
  {#if error}<div tabindex="-1" bind:this={errorBox}><ErrorAlert message={error} /></div>
    <button class="btn-ghost" onclick={load}>{m.common_retry()}</button>
  {:else if loading}<LoadingSpinner />
  {:else if message}
    <MailLetter
      topic={message.topic}
      from={message.from}
      replyTo={message.reply_to}
      body={message.body}
      footer={message.footer}
      createdAt={message.created_at}
    />
    <section>
      <div class="section-head">
        <h3 class="card-title">{m.mail_recipients()}</h3>
        <button class="btn-ghost" onclick={load}
          ><RefreshCw size={16} aria-hidden="true" />{m.mail_refresh()}</button
        >
      </div>
      <ul class="row-list" role="list">
        {#each message.recipients as r (r.id)}
          {@const Icon = statusIcons[r.status]}
          <li class="recipient">
            <div>
              <strong>{r.username || m.mail_unavailable()}</strong>
              {#if r.email}<p class="body-text">{r.email}</p>{/if}
            </div>
            <div class="outcome">
              <span class="meta-item" data-status={r.status}
                ><Icon size={14} aria-hidden="true" />{statuses[r.status]()}</span
              >
              {#if r.reason}<p class="body-text">{mailReason(r.reason)}</p>{/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {:else if !list.length}<p class="body-text" role="status">{m.mail_no_sent()}</p>
  {:else}
    <ul class="row-list" role="list">
      {#each list as item (item.id)}
        <li>
          <a
            class="row-link message-row"
            aria-label={item.subject}
            aria-describedby={'sent-meta-' + item.id}
            href={reportHref('sent', days, until, metric, undefined, item.id)}
          >
            <div>
              <strong class="message-title">{item.subject}</strong>
              <p class="meta-row" id={'sent-meta-' + item.id}>
                <span>{topicLabels[item.topic]()}</span>
                <time datetime={item.created_at}>{formatDateTime(item.created_at)}</time>
              </p>
            </div>
            <ChevronRight size={18} aria-hidden="true" />
          </a>
        </li>
      {/each}
    </ul>
    {#if cursors.length || next}<div class="composer-actions">
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
  .history {
    min-width: 0;
    max-width: var(--max-width-narrow);
    overflow-wrap: anywhere;
  }
  .section-head h3 {
    margin: 0;
  }
  .section-head,
  .recipient,
  .message-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .section-head,
  .recipient {
    flex-wrap: wrap;
  }
  .section-head {
    margin-bottom: var(--space-2);
  }
  .btn-ghost {
    gap: var(--space-2);
  }
  .recipient {
    align-items: baseline;
    padding-block: var(--space-3);
  }
  .recipient + .recipient {
    border-top: 1px solid var(--border);
  }
  .outcome {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .outcome :global(svg),
  .message-row :global(svg) {
    flex: none;
  }
  [data-status='failed'] {
    color: var(--status-bad);
  }
  [data-status='unknown'],
  [data-status='skipped'] {
    color: var(--status-ok);
  }
  .message-row :global(svg) {
    color: var(--text-muted);
  }
  .message-title {
    display: block;
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    font-weight: 600;
    margin: 0 0 var(--space-2);
  }
  @media (max-width: 720px) {
    .message-title {
      font-size: var(--text-base);
    }
  }
</style>

<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { ApiError, previewMail, queueMail } from '#lib/api.ts';
  import {
    getAdminMailSession,
    MailDraft,
    mailError,
    mailReason,
    topicLabels
  } from '#lib/admin-mail.svelte.ts';
  import { reportHref, type Cohort } from '#lib/admin-report.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import * as m from '#lib/paraglide/messages.js';
  import SelectedRecipients from './SelectedRecipients.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';

  let {
    view,
    days,
    until,
    metric,
    onDenied
  }: {
    view: 'compose' | 'review';
    days: number;
    until: string;
    metric: Cohort;
    onDenied: (status: number) => void;
  } = $props();
  const mail = getAdminMailSession();
  const scope = createSessionScope();
  onDestroy(scope.dispose);
  let draft = $derived(mail.draft);
  let review = $derived(view === 'review' ? draft.preview : null);
  let count = $derived(review?.recipients.filter((r) => !r.reason).length ?? 0);
  let error = $state('');
  let errorBox = $state<HTMLDivElement>();
  let heading = $state<HTMLHeadingElement>();
  function edit() {
    error = '';
    draft.preview = null;
  }
  async function failed(e: unknown, current: () => boolean) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onDenied(e.status);
      return;
    }
    const unknownQueueResult =
      draft.pending === 'send' &&
      (!(e instanceof ApiError) || (e.status >= 500 && e.code !== 'MAIL_DISABLED'));
    error = unknownQueueResult ? m.mail_queue_unconfirmed() : mailError(e);
    if (e instanceof ApiError && e.code === 'MAIL_REVIEW_EXPIRED') draft.preview = null;
    await tick();
    if (current()) errorBox?.focus();
  }
  async function preview(event: SubmitEvent) {
    event.preventDefault();
    const submitting = draft;
    if (!submitting.recipients.length || submitting.pending) return;
    const current = scope.begin();
    error = '';
    submitting.pending = 'preview';
    try {
      const result =
        submitting.preview && submitting.attemptedReview === submitting.preview.review
          ? submitting.preview
          : await previewMail(
              submitting.recipients.map((r) => r.id),
              submitting.topic,
              submitting.subject,
              submitting.body
            );
      if (!current() || mail.draft !== submitting) return;
      submitting.preview = result;
      await goto(reportHref('review', days, until, metric), { reset: false });
      await tick();
      if (current()) heading?.focus();
    } catch (e) {
      if (current()) await failed(e, current);
    } finally {
      submitting.pending = null;
    }
  }
  async function send() {
    const submitting = draft;
    if (!review || count === 0 || submitting.pending) return;
    const current = scope.begin();
    submitting.pending = 'send';
    submitting.attemptedReview = review.review;
    error = '';
    try {
      const { id } = await queueMail(review.review);
      if (mail.draft !== submitting) return;
      mail.draft = new MailDraft();
      if (current()) await goto(reportHref('sent', days, until, metric, undefined, id));
    } catch (e) {
      if (current()) await failed(e, current);
    } finally {
      submitting.pending = null;
    }
  }
</script>

<section class="page-stack">
  <h2 class="card-title" tabindex="-1" bind:this={heading}>
    {review ? m.mail_review() : m.mail_compose()}
  </h2>
  {#if error}<div tabindex="-1" bind:this={errorBox}><ErrorAlert message={error} /></div>{/if}
  {#if review}
    <dl>
      <div>
        <dt>{m.mail_topic()}</dt>
        <dd>{topicLabels[draft.topic]()}</dd>
      </div>
      <div>
        <dt>{m.mail_from()}</dt>
        <dd>{review.from}</dd>
      </div>
      <div>
        <dt>{m.mail_reply()}</dt>
        <dd>{review.reply_to}</dd>
      </div>
    </dl>
    <section class="panel">
      <h3>{draft.subject}</h3>
      <p class="copy">{draft.body}</p>
      <p class="copy">{review.footer}</p>
      <p>{m.mail_unsubscribe()}</p>
    </section>
    <section>
      <h3>{m.mail_recipients()}</h3>
      <ul>
        {#each review.recipients as person (person.id)}
          <li>
            <strong>{person.username || m.mail_unavailable()}</strong>
            {person.email}
            {#if person.reason}<small
                >{m.mail_excluded({ reason: mailReason(person.reason) })}</small
              >{/if}
          </li>
        {/each}
      </ul>
    </section>
    <div class="actions">
      <a class="btn-ghost" href={reportHref('compose', days, until, metric)}>{m.mail_edit()}</a>
      <button class="btn-primary" disabled={!count || !!draft.pending} onclick={send}
        >{count === 1 ? m.mail_send_one() : m.mail_send_many({ count })}</button
      >
    </div>
  {:else}
    <SelectedRecipients />
    <a href={reportHref('users', days, until, metric)}>{m.mail_choose()}</a>
    <form class="page-stack" onsubmit={preview}>
      <label class="field"
        ><span class="label-text">{m.mail_topic()}</span>
        <select class="input" bind:value={draft.topic} onchange={edit} disabled={!!draft.pending}>
          <option value="support">{m.mail_support()}</option><option value="product"
            >{m.mail_product()}</option
          >
        </select>
      </label>
      <label class="field"
        ><span class="label-text">{m.mail_subject()}</span>
        <input
          class="input"
          required
          maxlength="180"
          bind:value={draft.subject}
          oninput={edit}
          disabled={!!draft.pending}
        />
      </label>
      <label class="field"
        ><span class="label-text">{m.mail_body()}</span>
        <textarea
          class="input"
          required
          maxlength="8000"
          rows="8"
          bind:value={draft.body}
          oninput={edit}
          disabled={!!draft.pending}></textarea>
      </label>
      <div class="actions">
        <button class="btn-primary" disabled={!draft.recipients.length || !!draft.pending}
          >{m.mail_review()}</button
        >
      </div>
    </form>
  {/if}
  <p role="status">
    {draft.pending === 'preview'
      ? m.common_loading()
      : draft.pending === 'send'
        ? m.mail_submitting()
        : ''}
  </p>
</section>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .copy {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  dl,
  dd {
    margin: 0;
  }
  dl > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  dt,
  small {
    color: var(--text-muted);
  }
  small {
    display: block;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    padding-block: var(--space-2);
    border-block-end: 1px solid var(--border);
  }
  section,
  dd {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  textarea {
    resize: vertical;
  }
  [role='status']:empty {
    margin: 0;
  }
</style>

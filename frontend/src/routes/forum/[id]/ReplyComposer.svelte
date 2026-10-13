<script lang="ts">
  import ErrorAlert from '$lib/components/ErrorAlert.svelte';
  import GuestNotice from '$lib/components/GuestNotice.svelte';
  import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
  import type { PostingStatus } from '$lib/forum';
  import { localizedHref as href } from '$lib/i18n.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    /** The comment being answered. */
    target?: { username: string; preview: string } | null;
    /** The unfinished reply text; owned by the page so it survives a move. */
    draft: string;
    postingStatus: PostingStatus | null;
    submitting: boolean;
    error: string;
    onDraftChange: (value: string) => void;
    onSubmit: (event: SubmitEvent) => void;
    /** Present only where cancelling makes sense (the inline composer). */
    onCancel?: () => void;
  }

  let {
    target = null,
    draft,
    postingStatus,
    submitting,
    error,
    onDraftChange,
    onSubmit,
    onCancel
  }: Props = $props();

  let formEl = $state<HTMLFormElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  // Opening the composer puts the caret in it — at the end of a draft that is
  // still waiting there, so nothing has to be retyped.
  $effect(() => {
    if (!textareaEl) return;
    textareaEl.focus();
    const end = textareaEl.value.length;
    textareaEl.setSelectionRange(end, end);
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && onCancel) {
      event.stopPropagation();
      onCancel();
      return;
    }

    // Enter keeps its newline; the usual shortcut posts the reply.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formEl?.requestSubmit();
    }
  }
</script>

{#if postingStatus === 'guest'}
  <GuestNotice class="body-text" message={m.forum_guest_notice()} />
{:else if postingStatus === 'unverified'}
  <div class="notice gate-notice">
    <p class="gate-note">{m.forum_email_unverified_notice()}</p>
    <a class="link" href={href('/settings')}>{m.nav_settings()}</a>
  </div>
{:else if postingStatus === 'ready'}
  <form class="composer-form is-inline" bind:this={formEl} onsubmit={onSubmit}>
    {#if target}
      <p class="composer-target">
        <span class="composer-target-label">
          {m.forum_replying_to({ username: target.username })}
        </span>
        {#if target.preview}
          <span class="composer-target-preview">{target.preview}</span>
        {/if}
      </p>
    {/if}

    <label class="field">
      <span class="label-text">{m.forum_reply_label()}</span>
      <textarea
        class="textarea composer-textarea is-inline"
        maxlength="10000"
        placeholder={m.forum_reply_placeholder()}
        value={draft}
        bind:this={textareaEl}
        oninput={(event) => onDraftChange(event.currentTarget.value)}
        onkeydown={handleKeydown}></textarea>
    </label>

    {#if error}
      <ErrorAlert message={error} />
    {/if}

    <div class="composer-actions">
      <button type="submit" class="btn-primary" disabled={submitting}>
        {submitting ? m.common_saving() : m.forum_reply_submit()}
      </button>
      {#if onCancel}
        <button type="button" class="btn-ghost" onclick={onCancel}>{m.forum_cancel()}</button>
      {/if}
    </div>
  </form>
{:else}
  <LoadingSpinner />
{/if}

<style>
  .composer-target {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
    min-width: 0;
  }

  .composer-target-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .composer-target-preview {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    font-style: italic;
    color: var(--text-muted);
  }
</style>

<script lang="ts">
  import { CornerDownRight } from '@lucide/svelte';
  import type { ForumReplyContent } from '#lib/forum-replies.ts';
  import type { PostingStatus } from '#lib/forum.ts';
  import { authorLabel, formatDate } from '#lib/format.ts';
  import * as m from '#lib/paraglide/messages.js';
  import ReplyComposer from './ReplyComposer.svelte';

  interface Props {
    reply: ForumReplyContent;
    currentUsername: string | null;
    /** Username of the thread author, used to mark their replies. */
    threadAuthor?: string | null;
    /** Nesting level used to cap the visual indentation. */
    depth?: number;
    /** Id of the reply the open inline composer belongs to, if any. */
    replyTargetId?: string | null;
    /** The unfinished inline draft; owned by the page so it survives a move. */
    replyDraft?: string;
    replySubmitting?: boolean;
    replyError?: string;
    postingStatus?: PostingStatus | null;
    onDraftChange?: (value: string) => void;
    onCancelReply?: () => void;
    onSubmitReply?: (event: SubmitEvent) => void;
    onReply: (reply: ForumReplyContent) => void;
    onDelete: (replyId: string) => Promise<void>;
  }

  let {
    reply,
    currentUsername,
    threadAuthor = null,
    depth = 0,
    replyTargetId = null,
    replyDraft = '',
    replySubmitting = false,
    replyError = '',
    postingStatus = null,
    onDraftChange = () => {},
    onCancelReply = () => {},
    onSubmitReply = () => {},
    onReply,
    onDelete
  }: Props = $props();

  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let replyButton = $state<HTMLButtonElement | null>(null);

  const isAuthor = $derived(
    !reply.is_deleted && currentUsername !== null && reply.author?.username === currentUsername
  );

  const isOp = $derived(
    !reply.is_deleted && threadAuthor !== null && reply.author?.username === threadAuthor
  );

  /** The open inline composer belongs to this reply. */
  const isTarget = $derived(!reply.is_deleted && replyTargetId === reply.id);

  // Server pages retain parent context even when the parent is on another page.
  const parentMissing = $derived(!reply.is_deleted && depth === 0 && reply.parent_id !== null);

  let wasTarget = $state(false);

  // However the composer closes — cancelled or posted — the keyboard user is
  // put back on the button that opened it.
  $effect(() => {
    if (isTarget) {
      wasTarget = true;
      return;
    }
    if (wasTarget) {
      wasTarget = false;
      replyButton?.focus();
    }
  });

  function handleCancel(): void {
    onCancelReply();
  }

  async function handleDelete(): Promise<void> {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }

    if (deleting) return;
    deleting = true;
    try {
      // The page owns error reporting; the item is removed on success because
      // the reply tree is refetched.
      await onDelete(reply.id);
    } finally {
      deleting = false;
      confirmingDelete = false;
    }
  }
</script>

<div
  class="reply"
  class:is-deleted={reply.is_deleted}
  class:is-nested={depth > 0}
  style:--reply-depth={Math.min(depth, 3)}
>
  {#if reply.is_deleted}
    <div class="reply-main is-deleted">
      <div class="deleted-node" aria-label={m.forum_reply_deleted()}>
        <span class="deleted-dot" aria-hidden="true"></span>
        <p class="reply-text deleted-text">{m.forum_reply_deleted()}</p>
      </div>
    </div>
  {:else}
    <div class="reply-main">
      <div class="meta-row">
        <span class="reply-author">{authorLabel(reply.author)}</span>
        {#if isOp}
          <span class="chip">{m.forum_op_tag()}</span>
        {/if}
        {#if reply.author?.call_sign}
          <span class="callsign">{reply.author.call_sign}</span>
        {/if}
        <span class="reply-date">{formatDate(reply.created_at)}</span>
      </div>
      {#if parentMissing}
        <p class="reply-context">
          <span class="reply-context-icon" aria-hidden="true">
            <CornerDownRight size={13} />
          </span>
          <span class="reply-context-label"
            >{reply.parent_context && !reply.parent_context.is_deleted
              ? m.forum_replying_to_parent({ username: authorLabel(reply.parent_context.author) })
              : m.forum_replying_to_removed()}</span
          >
          {#if reply.parent_context?.body}<span>{reply.parent_context.body}</span>{/if}
        </p>
      {/if}
      <p class="reply-text">{reply.body}</p>
      <div class="reply-actions">
        <button
          type="button"
          class="action-quiet"
          aria-expanded={isTarget}
          bind:this={replyButton}
          onclick={() => onReply(reply)}
        >
          <CornerDownRight size={14} aria-hidden="true" />
          {m.forum_reply_button()}
        </button>
        {#if isAuthor}
          {#if confirmingDelete}
            <button
              type="button"
              class="action-quiet is-danger"
              disabled={deleting}
              onclick={handleDelete}
            >
              {m.forum_delete_confirm()}
            </button>
            <button type="button" class="action-quiet" onclick={() => (confirmingDelete = false)}>
              {m.forum_cancel()}
            </button>
          {:else}
            <button type="button" class="action-quiet is-danger" onclick={handleDelete}>
              {m.forum_delete_reply()}
            </button>
          {/if}
        {/if}
      </div>

      {#if isTarget}
        <!-- The answer is written beside the comment it answers, before the
             replies that comment already has. -->
        <div class="reply-composer-inline">
          <ReplyComposer
            target={{ username: authorLabel(reply.author), preview: reply.body ?? '' }}
            draft={replyDraft}
            {postingStatus}
            submitting={replySubmitting}
            error={replyError}
            {onDraftChange}
            onSubmit={onSubmitReply}
            onCancel={handleCancel}
          />
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .reply {
    --reply-line: color-mix(in srgb, var(--border-subtle) 82%, transparent);
    padding: var(--space-4) 0;
  }

  .reply.is-nested {
    margin-left: calc(var(--reply-depth) * var(--space-3));
    padding-left: var(--space-3);
    border-left: 1px solid var(--reply-line);
  }

  .reply-main {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-radius: var(--radius-sm);
  }

  .reply-main.is-deleted {
    gap: 0;
  }

  .deleted-node {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    width: fit-content;
    max-width: 100%;
    padding: 0.15rem 0;
  }

  .deleted-dot {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 50%;
    background-color: var(--border-subtle);
  }

  .deleted-text {
    margin: 0;
    color: var(--text-muted);
    font-style: italic;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }

  .reply-author {
    color: var(--text-primary);
    font-weight: 600;
  }

  .reply-context {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
    min-width: 0;
    padding: 0.35rem 0.55rem;
    border-left: 2px solid var(--reply-line);
    border-radius: var(--radius-xs);
    background-color: color-mix(in srgb, var(--bg-inset) 72%, transparent);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .reply-context-icon {
    flex: none;
    display: inline-flex;
    color: var(--accent);
  }

  .reply-context-label {
    min-width: 0;
    color: var(--text-secondary);
  }

  .reply-text {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .reply-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem var(--space-3);
  }

  .reply-composer-inline {
    margin-top: var(--space-2);
  }

  @media (max-width: 720px) {
    .reply {
      padding: var(--space-3) 0;
    }
  }
</style>

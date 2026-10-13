<script lang="ts">
  import { CornerDownRight } from '@lucide/svelte';
  import type { ForumReply } from '$lib/api';
  import type { PostingStatus } from '$lib/forum';
  import { authorLabel, formatDate } from '$lib/format';
  import * as m from '$lib/paraglide/messages';
  import ReplyComposer from './ReplyComposer.svelte';
  import Self from './ForumReplyItem.svelte';

  interface Props {
    reply: ForumReply;
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
    onReply: (reply: ForumReply) => void;
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

  // A reply that answers a parent no longer present in the tree renders at the
  // top level, so no connector shows what it answers; only then does the reply
  // repeat its parent relationship as a quiet note. Replies rendered under a
  // visible parent already read through the thread connectors.
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

<div class="reply" class:is-deleted={reply.is_deleted}>
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
          <span class="reply-context-label">{m.forum_replying_to_removed()}</span>
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

  {#if reply.children.length > 0}
    <div class="reply-children" class:flattened={depth >= 3}>
      {#each reply.children as child (child.id)}
        <Self
          reply={child}
          {currentUsername}
          {threadAuthor}
          depth={depth + 1}
          {replyTargetId}
          {replyDraft}
          {replySubmitting}
          {replyError}
          {postingStatus}
          {onDraftChange}
          {onCancelReply}
          {onSubmitReply}
          {onReply}
          {onDelete}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .reply {
    --reply-indent: 1.15rem;
    --reply-branch: 0.72rem;
    --reply-child-padding: var(--space-3);
    --reply-elbow-top: 0.78rem;
    --reply-parent-reach: var(--space-2);
    --reply-line: color-mix(in srgb, var(--border-subtle) 82%, transparent);
    padding: var(--space-4) 0;
  }

  .reply-children > :global(.reply) {
    position: relative;
    padding: var(--reply-child-padding) 0;
    border-bottom: none;
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

  .reply-children {
    position: relative;
    display: flex;
    flex-direction: column;
    margin-top: var(--space-2);
    margin-left: var(--space-2);
    padding-left: var(--reply-indent);
  }

  .reply-children > :global(.reply)::before {
    content: '';
    position: absolute;
    left: calc(-1 * var(--reply-indent));
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--reply-line);
  }

  .reply-children > :global(.reply:first-child)::before {
    top: calc(-1 * var(--reply-parent-reach));
  }

  .reply-children > :global(.reply:last-child)::before {
    bottom: auto;
    height: calc(var(--reply-child-padding) + var(--reply-elbow-top));
  }

  .reply-children > :global(.reply:first-child:last-child)::before {
    height: calc(var(--reply-parent-reach) + var(--reply-child-padding) + var(--reply-elbow-top));
  }

  .reply-children > :global(.reply > .reply-main) {
    position: relative;
  }

  .reply-children > :global(.reply > .reply-main)::before {
    content: '';
    position: absolute;
    left: calc(-1 * var(--reply-indent));
    top: var(--reply-elbow-top);
    width: var(--reply-branch);
    height: 1px;
    background: var(--reply-line);
  }

  .reply-children > :global(.reply.is-deleted) {
    --reply-elbow-top: 0.9rem;
  }

  .reply-children.flattened {
    margin-left: 0;
    padding-left: var(--space-3);
  }

  .reply-children.flattened > :global(.reply)::before {
    left: calc(-1 * var(--space-3));
    background: color-mix(in srgb, var(--border-subtle) 78%, transparent);
  }

  .reply-children.flattened > :global(.reply > .reply-main)::before {
    left: calc(-1 * var(--space-3));
    width: var(--space-2);
    background: color-mix(in srgb, var(--border-subtle) 78%, transparent);
  }

  @media (max-width: 720px) {
    .reply {
      --reply-indent: 0.85rem;
      --reply-branch: 0.5rem;
      --reply-child-padding: var(--space-2);
      padding: var(--space-3) 0;
    }

    .reply-children > :global(.reply) {
      padding: var(--reply-child-padding) 0;
    }

    .reply-children {
      margin-left: 0.2rem;
      padding-left: var(--reply-indent);
    }

    .reply-children.flattened {
      padding-left: var(--space-2);
    }

    .reply-children.flattened > :global(.reply > .reply-main)::before {
      left: calc(-1 * var(--space-2));
      width: 0.45rem;
    }
  }
</style>

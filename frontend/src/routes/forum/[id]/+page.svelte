<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { user } from '$lib/auth';
  import {
    ApiError,
    createForumReply,
    deleteForumReply,
    deleteForumThread,
    getForumThread,
    getForumThreadReplies,
    type ForumReply,
    type ForumThreadDetail
  } from '$lib/api';
  import {
    formatReplyCount,
    forumCategoryLabel,
    resolvePostingStatus,
    type PostingStatus
  } from '$lib/forum';
  import { localizeApiError } from '$lib/errorLocalization';
  import { extractErrorCode } from '$lib/errorCode';
  import { authorLabel, formatDate } from '$lib/format';
  import { localizedHref as href } from '$lib/i18n.svelte';
  import ErrorAlert from '$lib/components/ErrorAlert.svelte';
  import ForumReplyItem from './ForumReplyItem.svelte';
  import ReplyComposer from './ReplyComposer.svelte';
  import { ArrowLeft, CornerDownRight } from '@lucide/svelte';
  import { SITE_NAME } from '$lib/seo';
  import * as m from '$lib/paraglide/messages';

  const threadId = $derived(page.params.id);

  let thread = $state<ForumThreadDetail | null>(null);
  let replies = $state<ForumReply[]>([]);
  let loading = $state(true);
  let loadFailed = $state('');
  let notFound = $state(false);
  let loadToken = 0;

  let postingStatus = $state<PostingStatus | null>(null);

  // Two drafts. The comment composer answers one specific reply; the thread
  // composer starts a top-level reply from below the main post. Drafts live in
  // page state, so moving/cancelling composers does not drop typed text.
  let topDraft = $state('');
  let topError = $state('');
  let topSubmitting = $state(false);
  let threadComposerOpen = $state(false);

  let inlineDraft = $state('');
  // The target keeps the parent's body: "Replying to alan" alone does not say
  // which of alan's messages is being answered.
  let replyTarget = $state<{ id: string; username: string; preview: string } | null>(null);
  let replyError = $state('');
  let replySubmitting = $state(false);
  let repliesError = $state('');

  let threadDeleteArmed = $state(false);
  let deletingThread = $state(false);
  let deleteError = $state('');

  const isThreadAuthor = $derived(
    thread !== null && $user !== null && thread.author.username === $user.username
  );

  // Replies arrive as a nested tree; the visible count is the number of nodes.
  function countReplies(list: ForumReply[]): number {
    return list.reduce((sum, reply) => sum + 1 + countReplies(reply.children ?? []), 0);
  }

  let replyCount = $derived(countReplies(replies));

  $effect(() => {
    const id = threadId;
    if (!id) return;
    void loadThread(id);
  });

  $effect(() => {
    const username = $user?.username ?? null;
    let cancelled = false;
    postingStatus = null;
    void resolvePostingStatus(username).then((status) => {
      if (!cancelled) postingStatus = status;
    });
    return () => {
      cancelled = true;
    };
  });

  function isThreadNotFound(error: unknown): boolean {
    if (error instanceof ApiError && error.status === 404) return true;
    return extractErrorCode(error) === 'THREAD_NOT_FOUND';
  }

  async function loadThread(id: string): Promise<void> {
    const token = ++loadToken;
    loading = true;
    loadFailed = '';
    notFound = false;
    repliesError = '';
    deleteError = '';
    thread = null;
    replies = [];
    replyTarget = null;
    threadComposerOpen = false;
    threadDeleteArmed = false;

    try {
      const [threadData, replyData] = await Promise.all([
        getForumThread(id),
        getForumThreadReplies(id)
      ]);
      if (token !== loadToken) return;
      thread = threadData;
      replies = replyData.data;
    } catch (error) {
      if (token !== loadToken) return;
      if (isThreadNotFound(error)) {
        notFound = true;
      } else {
        loadFailed = localizeApiError(error, () => m.api_error_forum_query_failed());
      }
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  async function refreshReplies(): Promise<void> {
    const id = threadId;
    if (!id) return;

    try {
      const data = await getForumThreadReplies(id);
      replies = data.data;
      repliesError = '';
    } catch (error) {
      repliesError = localizeApiError(error, () => m.api_error_forum_query_failed());
    }
  }

  function retryLoad(): void {
    if (threadId) void loadThread(threadId);
  }

  function openThreadComposer(): void {
    threadComposerOpen = true;
    replyTarget = null;
    replyError = '';
    topError = '';
  }

  function cancelThreadComposer(): void {
    threadComposerOpen = false;
    topError = '';
  }

  function setReplyTarget(reply: ForumReply): void {
    threadComposerOpen = false;
    topError = '';
    replyTarget = {
      id: reply.id,
      username: authorLabel(reply.author),
      preview: reply.body ?? ''
    };
    replyError = '';
  }

  /** Closing the inline composer keeps whatever was typed into it. */
  function cancelReplyTarget(): void {
    replyTarget = null;
    replyError = '';
  }

  async function submitReply(event: SubmitEvent, composer: 'top' | 'inline'): Promise<void> {
    event.preventDefault();
    const id = threadId;
    if (!id) return;

    const inline = composer === 'inline';
    if (inline ? replySubmitting : topSubmitting) return;

    // The inline composer answers the open target; the page composer always
    // starts a new top-level reply.
    const parentId = inline ? replyTarget?.id : undefined;
    if (inline && !parentId) return;

    const fail = (message: string): void => {
      if (inline) {
        replyError = message;
      } else {
        topError = message;
      }
    };

    const body = (inline ? inlineDraft : topDraft).trim();
    if (!body) {
      fail(m.forum_reply_body_error());
      return;
    }

    if (inline) {
      replySubmitting = true;
      replyError = '';
    } else {
      topSubmitting = true;
      topError = '';
    }

    try {
      await createForumReply(id, body, parentId);
      if (inline) {
        inlineDraft = '';
        replyTarget = null;
      } else {
        topDraft = '';
        threadComposerOpen = false;
      }
      await refreshReplies();
    } catch (error) {
      fail(localizeApiError(error, () => m.api_error_forum_create_failed()));
    } finally {
      if (inline) {
        replySubmitting = false;
      } else {
        topSubmitting = false;
      }
    }
  }

  async function onDeleteReply(replyId: string): Promise<void> {
    try {
      await deleteForumReply(replyId);
      await refreshReplies();
    } catch (error) {
      repliesError = localizeApiError(error, () => m.api_error_forum_delete_failed());
    }
  }

  async function deleteThread(): Promise<void> {
    const id = threadId;
    if (!id || deletingThread) return;

    if (!threadDeleteArmed) {
      threadDeleteArmed = true;
      return;
    }

    deletingThread = true;
    deleteError = '';

    try {
      await deleteForumThread(id);
      await goto(href('/forum'));
    } catch (error) {
      deleteError = localizeApiError(error, () => m.api_error_forum_delete_failed());
    } finally {
      deletingThread = false;
      threadDeleteArmed = false;
    }
  }
</script>

<svelte:head>
  <title>{thread ? `${thread.title} | ${SITE_NAME}` : `${m.forum_title()} | ${SITE_NAME}`}</title>
</svelte:head>

<div class="page-narrow">
  <nav class="crumb-nav" aria-label={m.forum_title()}>
    <a class="crumb-link" href={href('/forum')}>
      <ArrowLeft size={14} aria-hidden="true" />
      {m.forum_back_to_threads()}
    </a>
  </nav>

  {#if loading}
    <div class="skeleton-rows">
      <div class="skeleton-row">
        <span class="skeleton skeleton-title"></span>
        <span class="skeleton skeleton-line"></span>
        <span class="skeleton skeleton-meta"></span>
      </div>
    </div>
    <p class="sr-only" role="status">{m.common_loading()}</p>
  {:else if notFound}
    <section class="state-block">
      <h1 class="state-title">{m.forum_thread_not_found_title()}</h1>
      <p class="body-text state-note">{m.forum_thread_not_found_body()}</p>
      <a class="btn-primary" href={href('/forum')}>{m.forum_back_to_threads()}</a>
    </section>
  {:else if loadFailed}
    <div class="state-error">
      <ErrorAlert message={loadFailed} />
      <button type="button" class="btn-ghost" onclick={retryLoad}>{m.forum_retry()}</button>
    </div>
  {:else if thread}
    <article class="thread-main">
      <header class="thread-head">
        <p class="thread-cat">
          <span class="chip-dot"></span>{forumCategoryLabel(thread.category)}
        </p>
        <h1 class="page-title">{thread.title}</h1>
        <p class="meta-row">
          <span class="thread-author">{authorLabel(thread.author)}</span>
          {#if thread.author.call_sign}
            <span class="callsign">{thread.author.call_sign}</span>
          {/if}
          <span>{formatDate(thread.created_at)}</span>
        </p>
      </header>
      <p class="body-text body-text--prose thread-body">{thread.body}</p>

      <div class="thread-actions">
        <div class="thread-action-row">
          <button
            type="button"
            class="action-quiet"
            aria-expanded={threadComposerOpen}
            onclick={openThreadComposer}
          >
            <CornerDownRight size={14} aria-hidden="true" />
            {m.forum_reply_thread_button()}
          </button>

          {#if isThreadAuthor}
            <button
              type="button"
              class="action-quiet is-danger"
              disabled={deletingThread}
              onclick={deleteThread}
            >
              {threadDeleteArmed ? m.forum_delete_confirm() : m.forum_delete_thread()}
            </button>
            {#if threadDeleteArmed}
              <button
                type="button"
                class="action-quiet"
                onclick={() => (threadDeleteArmed = false)}
              >
                {m.forum_cancel()}
              </button>
            {/if}
          {/if}
        </div>

        {#if deleteError}
          <ErrorAlert message={deleteError} />
        {/if}

        {#if threadComposerOpen}
          <div class="thread-composer-inline">
            <ReplyComposer
              target={{ username: authorLabel(thread.author), preview: thread.body }}
              draft={topDraft}
              {postingStatus}
              submitting={topSubmitting}
              error={topError}
              onDraftChange={(value) => (topDraft = value)}
              onSubmit={(event) => void submitReply(event, 'top')}
              onCancel={cancelThreadComposer}
            />
          </div>
        {/if}
      </div>
    </article>

    <section class="replies-section" aria-labelledby="replies-title">
      <h2 id="replies-title" class="panel-label replies-title">{formatReplyCount(replyCount)}</h2>

      {#if repliesError}
        <ErrorAlert message={repliesError} />
      {/if}

      {#if replies.length > 0}
        <div class="reply-tree">
          {#each replies as reply (reply.id)}
            <ForumReplyItem
              {reply}
              currentUsername={$user?.username ?? null}
              threadAuthor={thread.author?.username ?? null}
              replyTargetId={replyTarget?.id ?? null}
              replyDraft={inlineDraft}
              {replySubmitting}
              {replyError}
              {postingStatus}
              onDraftChange={(value) => (inlineDraft = value)}
              onCancelReply={cancelReplyTarget}
              onSubmitReply={(event) => void submitReply(event, 'inline')}
              onReply={setReplyTarget}
              onDelete={onDeleteReply}
            />
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .thread-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-bottom: var(--space-6);
  }

  .thread-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .thread-author {
    color: var(--text-primary);
    font-weight: 600;
  }

  /* The post body keeps primary ink over the shared prose scale
     (`.body-text--prose`), with the thread's own whitespace handling. */
  .thread-body {
    margin: 0;
    color: var(--text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .thread-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
  }

  .thread-action-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .thread-composer-inline {
    width: 100%;
  }

  .replies-section {
    margin-top: var(--space-5);
  }

  .replies-title {
    margin: 0 0 var(--space-3);
  }

  .reply-tree {
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 720px) {
    .crumb-nav {
      margin-bottom: var(--space-5);
    }

    .thread-main {
      gap: var(--space-4);
      padding-bottom: var(--space-5);
    }

    .thread-action-row {
      align-items: stretch;
    }

    .replies-section {
      margin-top: var(--space-4);
    }
  }
</style>

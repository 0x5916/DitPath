<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { user } from '$lib/auth';
  import {
    FORUM_CATEGORIES,
    createForumThread,
    getForumThreads,
    isForumCategory,
    type ForumCategoryValue,
    type ForumThreadSummary
  } from '$lib/api';
  import {
    formatReplyCount,
    forumCategoryLabel,
    resolvePostingStatus,
    type PostingStatus
  } from '$lib/forum';
  import { localizeApiError } from '$lib/errorLocalization';
  import { authorLabel, formatDate } from '$lib/format';
  import { localizedHref as href } from '$lib/i18n.svelte';
  import ErrorAlert from '$lib/components/ErrorAlert.svelte';
  import GuestNotice from '$lib/components/GuestNotice.svelte';
  import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
  import { Plus } from '@lucide/svelte';
  import { SITE_NAME } from '$lib/seo';
  import * as m from '$lib/paraglide/messages';

  let threads = $state<ForumThreadSummary[]>([]);
  let nextCursor = $state<string | null>(null);
  let totalCount = $state<number | null>(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let loadFailed = $state('');
  let loadMoreError = $state('');
  let loadToken = 0;

  let composerOpen = $state(false);
  let postingStatus = $state<PostingStatus | null>(null);
  let composerCategory = $state<ForumCategoryValue>('general');
  let composerTitle = $state('');
  let composerBody = $state('');
  let composerError = $state('');
  let composerSubmitting = $state(false);

  // The active filter lives in the URL so the selection survives back/forward
  // navigation from a thread detail page and filtered lists can be shared. The
  // query string is read client-side only: `url.searchParams` is inaccessible
  // while this page is being prerendered.
  let filter = $state<ForumCategoryValue | null>(null);
  let filterInitialized = $state(false);

  /** Placeholder rows shown while the first page loads. */
  const SKELETON_ROWS = [0, 1, 2, 3];

  function categoryFromUrl(value: string | null): ForumCategoryValue | null {
    return isForumCategory(value) ? value : null;
  }

  function syncFilterFromUrl(): void {
    if (typeof window === 'undefined') return;
    const next = categoryFromUrl(new URLSearchParams(window.location.search).get('category'));
    filterInitialized = true;
    if (next !== filter) filter = next;
  }

  // Filtering is navigation, so the controls are real links: they are
  // shareable, crawlable, and the back button behaves like a browser.
  function categoryHref(category: ForumCategoryValue): string {
    return `?category=${category}`;
  }

  onMount(syncFilterFromUrl);
  afterNavigate(syncFilterFromUrl);

  $effect(() => {
    if (!filterInitialized) return;
    const category = filter;
    void loadFirstPage(category);
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

  async function loadFirstPage(category: ForumCategoryValue | null): Promise<void> {
    const token = ++loadToken;
    loading = true;
    loadFailed = '';
    loadMoreError = '';
    nextCursor = null;

    try {
      const result = await getForumThreads({ category });
      if (token !== loadToken) return;
      threads = result.data;
      nextCursor = result.next_cursor;
      totalCount = result.total;
    } catch (error) {
      if (token !== loadToken) return;
      threads = [];
      totalCount = null;
      loadFailed = localizeApiError(error, () => m.api_error_forum_query_failed());
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor;
    if (!cursor || loadingMore) return;

    const token = loadToken;
    loadingMore = true;
    loadMoreError = '';

    try {
      const result = await getForumThreads({ category: filter, cursor });
      if (token !== loadToken) return;
      threads = [...threads, ...result.data];
      nextCursor = result.next_cursor;
    } catch (error) {
      if (token === loadToken) {
        loadMoreError = localizeApiError(error, () => m.api_error_forum_query_failed());
      }
    } finally {
      loadingMore = false;
    }
  }

  function selectCategory(category: ForumCategoryValue | null): void {
    if (category === filter) return;
    const path = category ? `${href('/forum')}${categoryHref(category)}` : href('/forum');
    void goto(path, { keepFocus: true, noScroll: true });
  }

  function closeComposer(): void {
    composerOpen = false;
    composerError = '';
  }

  function resetComposer(): void {
    composerCategory = 'general';
    composerTitle = '';
    composerBody = '';
    composerError = '';
  }

  async function submitThread(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (composerSubmitting) return;

    const title = composerTitle.trim();
    const body = composerBody.trim();

    if (title.length < 3 || title.length > 200) {
      composerError = m.forum_thread_title_error();
      return;
    }

    if (!body) {
      composerError = m.forum_thread_body_error();
      return;
    }

    composerSubmitting = true;
    composerError = '';

    try {
      const createdCategory = composerCategory;
      await createForumThread(createdCategory, title, body);
      composerOpen = false;
      resetComposer();
      // Make the new thread visible: jump to its category when the active
      // filter would hide it, otherwise refresh the list the visitor sees.
      if (filter !== null && filter !== createdCategory) {
        selectCategory(createdCategory);
      } else {
        void loadFirstPage(filter);
      }
    } catch (error) {
      composerError = localizeApiError(error, () => m.api_error_forum_create_failed());
    } finally {
      composerSubmitting = false;
    }
  }
</script>

<svelte:head>
  <title>{m.forum_title()} | {SITE_NAME}</title>
</svelte:head>

<div class="forum-page">
  <header class="forum-masthead">
    <div class="masthead-row">
      <div class="masthead-text">
        <h1 class="page-title">{m.forum_title()}</h1>
        <p class="body-text forum-intro">{m.forum_intro()}</p>
      </div>
      <button
        type="button"
        class="btn-primary"
        aria-expanded={composerOpen}
        onclick={() => (composerOpen ? closeComposer() : (composerOpen = true))}
      >
        <Plus size={16} aria-hidden="true" />
        {m.forum_new_thread()}
      </button>
    </div>
  </header>

  <nav class="forum-filters" aria-label={m.forum_categories_navigation()}>
    <a
      class="filter-link"
      class:is-active={filter === null}
      aria-current={filter === null ? 'page' : undefined}
      href="?">{m.forum_category_all()}</a
    >
    {#each FORUM_CATEGORIES as category (category)}
      <a
        class="filter-link"
        class:is-active={filter === category}
        aria-current={filter === category ? 'page' : undefined}
        href={categoryHref(category)}>{forumCategoryLabel(category)}</a
      >
    {/each}
    {#if totalCount !== null && !loading && (filter !== null || nextCursor !== null || threads.length < totalCount)}
      <span class="filter-count"
        >{m.forum_threads_count({
          shown: String(threads.length),
          total: String(totalCount)
        })}</span
      >
    {/if}
  </nav>

  {#if composerOpen}
    <section class="panel composer">
      <h2 class="card-title">{m.forum_new_thread_heading()}</h2>

      {#if postingStatus === 'guest'}
        <GuestNotice class="body-text" message={m.forum_guest_notice()} />
        <div class="composer-actions">
          <button type="button" class="btn-ghost" onclick={closeComposer}>
            {m.forum_cancel()}
          </button>
        </div>
      {:else if postingStatus === 'unverified'}
        <div class="notice gate-notice">
          <p class="gate-note">{m.forum_email_unverified_notice()}</p>
          <a class="link" href={href('/settings')}>{m.nav_settings()}</a>
        </div>
        <div class="composer-actions">
          <button type="button" class="btn-ghost" onclick={closeComposer}>
            {m.forum_cancel()}
          </button>
        </div>
      {:else if postingStatus === 'ready'}
        <form class="composer-form" onsubmit={submitThread}>
          <label class="field">
            <span class="label-text">{m.forum_thread_category_label()}</span>
            <select class="select" bind:value={composerCategory}>
              {#each FORUM_CATEGORIES as category (category)}
                <option value={category}>{forumCategoryLabel(category)}</option>
              {/each}
            </select>
          </label>

          <label class="field">
            <span class="label-text">{m.forum_thread_title_label()}</span>
            <input
              class="input"
              type="text"
              maxlength="200"
              placeholder={m.forum_thread_title_placeholder()}
              bind:value={composerTitle}
            />
          </label>

          <label class="field">
            <span class="label-text">{m.forum_thread_body_label()}</span>
            <textarea
              class="textarea composer-textarea"
              maxlength="10000"
              placeholder={m.forum_thread_body_placeholder()}
              bind:value={composerBody}></textarea>
          </label>

          {#if composerError}
            <ErrorAlert message={composerError} />
          {/if}

          <div class="composer-actions">
            <button type="submit" class="btn-primary" disabled={composerSubmitting}>
              {composerSubmitting ? m.common_saving() : m.forum_thread_submit()}
            </button>
            <button type="button" class="btn-ghost" onclick={closeComposer}>
              {m.forum_cancel()}
            </button>
          </div>
        </form>
      {:else}
        <LoadingSpinner />
      {/if}
    </section>
  {/if}

  {#if loading}
    <div class="skeleton-rows">
      {#each SKELETON_ROWS as row (row)}
        <div class="skeleton-row">
          <span class="skeleton skeleton-title"></span>
          <span class="skeleton skeleton-meta"></span>
        </div>
      {/each}
    </div>
    <p class="sr-only" role="status">{m.common_loading()}</p>
  {:else if loadFailed}
    <div class="state-error">
      <ErrorAlert message={loadFailed} />
      <button type="button" class="btn-ghost" onclick={() => loadFirstPage(filter)}>
        {m.forum_retry()}
      </button>
    </div>
  {:else if threads.length === 0}
    <section class="state-block">
      <h2 class="state-title">
        {filter
          ? m.forum_threads_empty_filtered_title({ category: forumCategoryLabel(filter) })
          : m.forum_threads_empty_title()}
      </h2>
      {#if filter}
        <a class="link" href="?">{m.forum_category_all()}</a>
      {/if}
    </section>
  {:else}
    <ul class="row-list thread-list">
      {#each threads as thread (thread.id)}
        <li>
          <a class="row-link thread-row" href={href(`/forum/${thread.id}`)}>
            <h2 class="thread-title">{thread.title}</h2>
            <p class="meta-row">
              <span class="thread-cat"
                ><span class="chip-dot"></span>{forumCategoryLabel(thread.category)}</span
              >
              <span>{authorLabel(thread.author)}</span>
              {#if thread.author.call_sign}
                <span class="callsign">{thread.author.call_sign}</span>
              {/if}
              <span>{formatDate(thread.created_at)}</span>
              <span class="thread-replies">{formatReplyCount(thread.reply_count)}</span>
            </p>
          </a>
        </li>
      {/each}
    </ul>

    {#if loadMoreError}
      <ErrorAlert message={loadMoreError} />
    {/if}

    {#if nextCursor}
      <div class="load-more-row">
        <button type="button" class="btn-ghost" disabled={loadingMore} onclick={loadMore}>
          {loadingMore ? m.common_loading() : m.forum_threads_load_more()}
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .forum-masthead {
    margin-bottom: var(--space-6);
  }

  .masthead-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
    flex-wrap: wrap;
  }

  .masthead-text {
    flex: 1 1 26rem;
    min-width: 0;
  }

  .masthead-row :global(.btn-primary) {
    flex: none;
  }

  .forum-intro {
    margin: var(--space-2) 0 0;
    max-width: var(--max-width-narrow);
    line-height: var(--leading-relaxed);
  }

  /* Filters are links on a hairline: navigation, not a row of chips. */
  .forum-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.65rem var(--space-4);
    padding-bottom: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .filter-link {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0 0.45rem;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: var(--leading-snug);
    text-decoration: none;
  }

  /* A short label like "All" is only as wide as its text. This overlay grows
     the pointer target without moving the chip or stretching the active rule. */
  .filter-link::after {
    content: '';
    position: absolute;
    inset: -0.3rem -0.45rem;
  }

  .filter-link:hover {
    color: var(--text-primary);
  }

  .filter-link.is-active {
    color: var(--text-primary);
    font-weight: 600;
    /* Inset rule rather than a positioned pseudo-element: it stays attached to
       its own link when the filter row wraps on narrow screens. */
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .filter-count {
    margin-left: auto;
    padding-left: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .composer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--block-gap);
  }

  /* The panel's flex gap owns the rhythm, so the shared heading drops its
     bottom margin here. */
  .composer :global(.card-title) {
    margin-bottom: 0;
  }

  /* A thread row is a `.row-link`, so it inherits the shared row spec — row
     padding and the inset + 2px amber edge on hover/focus. Rows are separated
     by whitespace, not rules (see `.row-list` in app.css); the list itself only
     carries the gap to the next block. */
  .thread-list {
    margin-bottom: var(--block-gap);
  }

  .thread-row {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .thread-title {
    margin: 0;
    max-width: 58rem;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-snug);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .thread-replies {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .load-more-row {
    display: flex;
    justify-content: flex-start;
    margin-top: var(--block-gap);
  }

  @media (max-width: 720px) {
    .forum-masthead {
      margin-bottom: var(--space-5);
    }

    .masthead-row {
      align-items: stretch;
      gap: var(--space-4);
    }

    .masthead-row :global(.btn-primary) {
      width: 100%;
      justify-content: center;
    }

    .forum-filters {
      gap: 0.55rem var(--space-3);
      margin-bottom: var(--space-4);
    }

    .filter-count {
      flex-basis: 100%;
      margin-left: 0;
      padding-left: 0;
    }

    .thread-title {
      font-size: var(--text-base);
    }
  }

  @media (max-width: 639px) {
    .forum-filters {
      gap: 0.25rem;
    }

    .filter-link {
      min-height: 2.75rem;
      padding: 0.25rem 0.3rem;
    }

    /* Phones pack the chips 4px apart, so the overlay would only overlap
       neighbouring targets. The 44px height floor already does the work. */
    .filter-link::after {
      display: none;
    }
  }
</style>

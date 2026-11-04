<script lang="ts">
  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import { learningSyncState } from '#lib/learning-sync.svelte.ts';
  import { recallAction } from '#lib/components/learning/recall-action.ts';
  import { homeCourseAction } from '#lib/data/home-course-action.ts';
  const learning = createLearningView();
  import { onMount } from 'svelte';
  import {
    ArrowRight,
    ChevronRight,
    CircleAlert,
    Dumbbell,
    Radio,
    RotateCcw,
    Wrench
  } from '@lucide/svelte';
  import HomeLanding from '#lib/components/home/HomeLanding.svelte';
  import PracticeActivity from '#lib/components/progress/PracticeActivity.svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import { openTrainingDb, closeTrainingDb } from '#lib/data/training-db.ts';
  import { loadHomeDashboard } from '#lib/data/home-dashboard.ts';
  import { clearHomeView, readHomeView, retainHomeView } from '#lib/data/home-view-cache.ts';
  import { resolveHomeView } from '#lib/data/home-view-state.ts';
  import {
    getTrainingOwner,
    subscribeTrainingSync,
    trainingSyncState
  } from '#lib/training-sync.svelte.ts';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  // The prerendered shell is unresolved, not the public landing page. A
  // resolved landing state requires both owner-scoped reads to finish.
  let retainedDashboard = $state(false);
  let loading = $state(true);
  let loadError = $state(false);
  let dashboard = $state.raw<Awaited<ReturnType<typeof loadHomeDashboard>> | null>(null);
  let mounted = false;
  let loadVersion = 0;
  let loadedOwner: string | null = null;
  let activeDb: IDBDatabase | null = null;
  let coveragePending = $derived.by(() => {
    const owner = getTrainingOwner();
    return (
      owner.startsWith('account:') &&
      (learningSyncState.owner !== owner || !learningSyncState.initialized)
    );
  });
  let resolution = $derived(
    resolveHomeView({
      owner: getTrainingOwner(),
      dashboard: dashboard ? { hasActivity: dashboard.hasActivity } : null,
      snapshot: learning.snapshot
        ? {
            ownerKey: learning.snapshot.ownerKey,
            hasProspectiveEvidence: learning.snapshot.hasProspectiveEvidence
          }
        : null,
      loadError,
      learningFailed: learning.failed,
      coveragePending,
      snapshotSettled: learning.settled,
      retainedDashboard
    })
  );
  let viewState = $derived(resolution.viewState);
  let recommendationState = $derived(resolution.recommendationState);
  let guidedLink = $derived.by(() => {
    const path = '/morse/learn';
    const eyebrow = m.home_guided_eyebrow();
    if (!dashboard) return { eyebrow, title: m.nav_learn(), hint: '', path };
    const action = homeCourseAction(dashboard);
    if (action.kind === 'unfinished')
      return {
        eyebrow,
        title: m.home_lesson_title({ step: action.step, characters: action.characters }),
        hint: m.learn_restart_title({ step: action.step }),
        path
      };
    if (action.kind === 'complete')
      return { eyebrow, title: m.nav_learn(), hint: m.learn_complete_title(), path };
    return {
      eyebrow,
      title: m.home_start_lesson_title({
        step: action.step,
        characters: action.characters.split('').join(', ')
      }),
      hint: action.reviewChars.length
        ? m.learn_review_title({ characters: action.reviewChars.join(', ') })
        : '',
      path: `${path}/session?step=${action.step}`
    };
  });
  let recallLink = $derived.by(() => {
    const eyebrow = m.home_recall_eyebrow();
    const path = '/morse/review';
    const snapshot = learning.snapshot;
    if (!snapshot || recommendationState !== 'ready')
      return { eyebrow, title: m.review_page_title(), hint: m.home_recall_hint(), path };
    if (!snapshot.knownCharacters.length && !snapshot.hasProspectiveEvidence)
      return { eyebrow, title: m.review_page_title(), hint: m.home_recall_empty_hint(), path };
    const action = recallAction(snapshot.recommendation.primary, snapshot.knownCharacters);
    return {
      eyebrow,
      title: action.title,
      hint:
        action.hint ||
        (snapshot.coverage === 'partial'
          ? m.learning_coverage_partial()
          : m.learning_overview_profile({ speed: snapshot.profile.charWpm })),
      path: action.href
    };
  });

  async function loadHome() {
    const owner = getTrainingOwner();
    const version = ++loadVersion;
    // Keep this owner's last result visible while sync refreshes it.
    if (owner !== loadedOwner) {
      clearHomeView();
      retainedDashboard = false;
      loadedOwner = null;
      dashboard = null;
      loading = true;
    }
    loadError = false;
    if (activeDb) closeTrainingDb(activeDb);
    activeDb = null;
    const current = () => mounted && version === loadVersion && owner === getTrainingOwner();
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      if (!current()) return;
      activeDb = db;
      const result = await loadHomeDashboard(db, owner, new Date().toISOString());
      if (current()) {
        dashboard = result;
        loadedOwner = owner;
      }
    } catch {
      if (current()) loadError = true;
    } finally {
      if (db) closeTrainingDb(db);
      if (activeDb === db) activeDb = null;
      if (current()) loading = false;
    }
  }

  function retryHome() {
    if (loadError || !dashboard) void loadHome();
    if (learning.failed) void learning.refresh();
  }

  onMount(() => {
    const stopLearning = learning.start();
    mounted = true;
    const owner = getTrainingOwner();
    const retained = readHomeView(owner);
    if (retained) {
      dashboard = retained.dashboard;
      retainedDashboard = true;
      loadedOwner = retained.owner;
      loading = false;
    }
    let revision = '';
    const unsubscribe = subscribeTrainingSync(({ owner, version }) => {
      const next = `${owner}:${version}`;
      if (revision === next) return;
      revision = next;
      void loadHome();
    });
    return () => {
      unsubscribe();
      stopLearning();
      mounted = false;
      loadVersion++;
      if (activeDb) closeTrainingDb(activeDb);
    };
  });

  // Only a resolved dashboard is retained. A landing decision is a negative
  // claim and is always revalidated, so activity saved in another tab cannot
  // leave the next Home return showing the public landing page.
  $effect(() => {
    if (resolution.viewState !== 'dashboard' || !loadedOwner || !dashboard) return;
    retainHomeView({ owner: loadedOwner, dashboard });
  });
</script>

{#if viewState === 'landing'}
  <HomeLanding />
{:else}
  <div class="page-narrow page-stack home-dashboard">
    <header class="home-heading">
      <h1 class="page-title">{m.home_dashboard_title()}</h1>
      <a class="link browse-lessons" href={href('/morse/learn')}>
        {m.home_all_lessons()}<ArrowRight size={16} aria-hidden="true" />
      </a>
    </header>
    <nav aria-label={m.home_go_title()}>
      <ul class="training-links">
        <li>
          {#if !dashboard && loadError}
            <div class="training-link training-link--recommended recommendation-state" role="alert">
              <CircleAlert size={24} aria-hidden="true" />
              <span>
                <strong class="training-title">{m.progress_load_error()}</strong>
                <button type="button" class="recommendation-retry" onclick={retryHome}
                  >{m.progress_retry()}</button
                >
              </span>
            </div>
          {:else if !dashboard}
            <div
              class="training-link training-link--recommended recommendation-state"
              role="status"
            >
              <Radio size={24} aria-hidden="true" />
              <span>
                <span class="training-eyebrow">{m.home_guided_eyebrow()}</span>
                <strong class="training-title">{m.common_loading()}</strong>
              </span>
            </div>
          {:else}
            <a class="training-link training-link--recommended" href={href(guidedLink.path)}>
              <Radio size={24} aria-hidden="true" />
              <span>
                <span class="training-eyebrow">{guidedLink.eyebrow}</span>
                <strong class="training-title">{guidedLink.title}</strong>
                {#if guidedLink.hint}<span class="lesson-hint">{guidedLink.hint}</span>{/if}
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          {/if}
        </li>
        <li>
          {#if recommendationState === 'error'}
            <div class="training-link recommendation-state recall-link-card" role="alert">
              <CircleAlert size={24} aria-hidden="true" />
              <span>
                <span class="training-eyebrow">{m.home_recall_eyebrow()}</span>
                <strong class="training-title">{m.progress_load_error()}</strong>
                <button type="button" class="recommendation-retry" onclick={retryHome}
                  >{m.progress_retry()}</button
                >
              </span>
            </div>
          {:else if recommendationState === 'loading'}
            <div class="training-link recommendation-state recall-link-card" role="status">
              <RotateCcw size={24} aria-hidden="true" />
              <span>
                <span class="training-eyebrow">{m.home_recall_eyebrow()}</span>
                <strong class="training-title">{m.common_loading()}</strong>
              </span>
            </div>
          {:else}
            <a class="training-link recall-link-card" href={href(recallLink.path)}>
              <RotateCcw size={24} aria-hidden="true" />
              <span>
                <span class="training-eyebrow">{recallLink.eyebrow}</span>
                <strong class="training-title">{recallLink.title}</strong>
                {#if recallLink.hint}<span class="lesson-hint">{recallLink.hint}</span>{/if}
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          {/if}
        </li>
      </ul>
      <div class="home-secondary">
        <a class="training-link" href={href('/morse/practice')}>
          <Dumbbell size={24} aria-hidden="true" />
          <span>
            <strong class="training-title">{m.nav_practice()}</strong>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </a>
        <a class="reference-link" href={href('/morse')}>
          <Wrench size={20} aria-hidden="true" />
          <span>
            <strong>{m.morse_title()}</strong>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </a>
      </div>
    </nav>
    <section class="home-progress" aria-labelledby="home-progress-title">
      <div class="progress-heading">
        <h2 id="home-progress-title">{m.nav_progress()}</h2>
        <a class="link" href={href('/morse/progress')}>{m.home_view_progress()}</a>
      </div>
      {#if loading}
        <div class="skeleton progress-skeleton" role="status">
          <span class="sr-only">{m.common_loading()}</span>
        </div>
      {:else if loadError}
        <p role="alert" class="body-text">{m.progress_load_error()}</p>
        <button type="button" class="btn-primary" onclick={loadHome}>{m.progress_retry()}</button>
      {:else if dashboard?.hasActivity}
        <PracticeActivity {...dashboard.summary} />
      {:else}
        <p class="body-text">{m.progress_empty_description()}</p>
      {/if}
      {#if dashboard}
        <TrainingSyncStatus
          owner={trainingSyncState.owner}
          pending={trainingSyncState.pending}
          error={trainingSyncState.error}
          syncing={trainingSyncState.syncing}
          synced={trainingSyncState.synced}
        />
      {/if}
    </section>
  </div>
{/if}

<style>
  .home-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }
  .browse-lessons {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--answer-target-min);
    font-size: var(--text-sm);
  }
  .training-links {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .training-link.training-link--recommended {
    background: var(--accent-cta);
    border-color: var(--accent-cta);
    color: var(--on-accent);
  }
  .training-link.training-link--recommended:hover {
    background: var(--accent-cta-h);
  }
  .training-link.training-link--recommended :global(svg),
  .training-link.training-link--recommended .lesson-hint {
    color: var(--on-accent);
  }
  .training-link,
  .reference-link {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--answer-target-min);
    color: var(--text-primary);
    text-decoration: none;
  }
  .training-link {
    padding: var(--space-5);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    height: 100%;
  }
  .reference-link {
    padding: var(--space-4);
    margin-top: var(--space-2);
  }
  .training-link:hover,
  .reference-link:hover {
    background: var(--bg-inset);
  }
  .training-link :global(svg),
  .reference-link :global(svg) {
    color: var(--accent);
  }
  .training-title {
    display: block;
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .training-eyebrow {
    display: block;
    margin-bottom: var(--space-1);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--accent);
  }
  .training-link.training-link--recommended .training-eyebrow {
    color: var(--on-accent);
  }
  .recall-link-card {
    border-color: var(--accent);
  }
  .home-secondary {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .home-secondary .reference-link {
    margin-top: 0;
  }
  .lesson-hint {
    display: block;
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--accent);
  }
  .recommendation-state {
    cursor: default;
  }
  .recommendation-retry {
    display: inline-flex;
    align-items: center;
    min-height: var(--answer-target-min);
    margin-top: var(--space-1);
    padding: 0;
    border: 0;
    background: none;
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }
  .recommendation-retry:focus-visible {
    outline: 2px solid var(--on-accent);
    outline-offset: 2px;
  }
  .home-progress {
    display: grid;
    gap: var(--space-4);
  }
  .progress-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .progress-heading h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
  }
  .progress-heading a {
    display: inline-flex;
    align-items: center;
    min-height: var(--answer-target-min);
  }
  .progress-skeleton {
    min-height: 8rem;
  }
  @media (min-width: 600px) {
    .training-links,
    .home-secondary {
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    }
  }
</style>

<script lang="ts">
  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import { learningSyncState } from '#lib/learning-sync.svelte.ts';
  import { learningRecommendationHref } from '#lib/data/learning-snapshot.ts';
  import { recommendationTitle } from '#lib/components/learning/recommendation-copy.ts';
  const learning = createLearningView();
  import { onMount } from 'svelte';
  import { ArrowRight, ChevronRight, CircleAlert, Dumbbell, Radio, Wrench } from '@lucide/svelte';
  import HomeLanding from '#lib/components/home/HomeLanding.svelte';
  import PracticeActivity from '#lib/components/progress/PracticeActivity.svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import { openTrainingDb, closeTrainingDb } from '#lib/data/training-db.ts';
  import { loadHomeDashboard } from '#lib/data/home-dashboard.ts';
  import { clearHomeView, readHomeView, retainHomeView } from '#lib/data/home-view-cache.ts';
  import { resolveHomeView } from '#lib/data/home-view-state.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import {
    getTrainingOwner,
    subscribeTrainingSync,
    trainingSyncState
  } from '#lib/training-sync.svelte.ts';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { openLearningPilotDb, getLearningPilotHistory } from '#lib/data/learning-pilot.ts';

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
  let recentReview = $state(false);
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
  let lessonLink = $derived.by(() => {
    const title = m.nav_learn();
    const path = '/morse/learn';
    if (!dashboard) return { title, hint: '', path };
    const unfinished = dashboard.unfinishedSession;
    const snapshot = learning.snapshot;
    if (!unfinished && snapshot && snapshot.knownCharacters.length >= 2) {
      const primary = snapshot.recommendation.primary;
      return {
        title: recommendationTitle(primary),
        hint:
          snapshot.coverage === 'partial'
            ? m.learning_coverage_partial()
            : m.learning_overview_profile({ speed: snapshot.profile.charWpm }),
        path: learningRecommendationHref(primary, snapshot.knownCharacters)
      };
    }
    if (dashboard.returning && !unfinished && !recentReview)
      return {
        title: m.review_return_title(),
        hint: m.review_return_hint(),
        path: '/morse/learn/session?review=return'
      };
    if (dashboard.guidance.courseComplete && !unfinished)
      return { title, hint: m.learn_complete_title(), path };
    const { currentStep, reviewChars } = dashboard.guidance;
    const step = unfinished?.step ?? currentStep;
    const characters = (LESSONS[step - 1] ?? '').split('').join(', ');
    return {
      title: unfinished
        ? m.home_lesson_title({ step, characters })
        : m.home_start_lesson_title({ step, characters }),
      hint: unfinished
        ? m.learn_restart_title({ step })
        : reviewChars.length
          ? m.learn_review_title({ characters: reviewChars.join(', ') })
          : '',
      path: unfinished ? path : `${path}/session?step=${step}`
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
      recentReview = false;
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
      let pilotDb: IDBDatabase | null = null;
      try {
        pilotDb = await openLearningPilotDb();
        const reviews = await getLearningPilotHistory(pilotDb, owner);
        if (current())
          recentReview = reviews.some(
            (review) =>
              review.status === 'completed' &&
              review.completedAt &&
              Date.parse(review.completedAt) <= Date.now() &&
              Date.parse(review.completedAt) >= Date.now() - 14 * 86400000
          );
      } catch {
        // Local review storage must not prevent access to existing lessons/history.
        if (current()) recentReview = false;
      } finally {
        pilotDb?.close();
      }
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
      recentReview = retained.recentReview;
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
    retainHomeView({ owner: loadedOwner, dashboard, recentReview });
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
          {#if recommendationState === 'ready'}
            <a class="training-link training-link--recommended" href={href(lessonLink.path)}>
              <Radio size={24} aria-hidden="true" />
              <span>
                <strong class="training-title">{lessonLink.title}</strong>
                {#if lessonLink.hint}<span class="lesson-hint">{lessonLink.hint}</span>{/if}
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          {:else if recommendationState === 'error'}
            <div class="training-link training-link--recommended recommendation-state" role="alert">
              <CircleAlert size={24} aria-hidden="true" />
              <span>
                <strong class="training-title">{m.progress_load_error()}</strong>
                <button type="button" class="recommendation-retry" onclick={retryHome}
                  >{m.progress_retry()}</button
                >
              </span>
            </div>
          {:else}
            <div
              class="training-link training-link--recommended recommendation-state"
              role="status"
            >
              <Radio size={24} aria-hidden="true" />
              <span><strong class="training-title">{m.common_loading()}</strong></span>
            </div>
          {/if}
        </li>
        <li>
          <a class="training-link" href={href('/morse/practice')}>
            <Dumbbell size={24} aria-hidden="true" />
            <span>
              <strong class="training-title">{m.nav_practice()}</strong>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </a>
        </li>
      </ul>
      <a class="reference-link" href={href('/morse')}>
        <Wrench size={20} aria-hidden="true" />
        <span>
          <strong>{m.morse_title()}</strong>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </a>
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
    font-size: var(--text-lg);
    font-weight: 600;
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
    .training-links {
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    }
  }
</style>

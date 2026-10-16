<script lang="ts">
  import { onMount } from 'svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { closeTrainingDb, openTrainingDb } from '#lib/data/training-db.ts';
  import { createAttemptRepository } from '#lib/data/attempt-repository.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import { summarizeProgress, type ProgressSummary } from '#lib/training/v2/progress-summary.ts';
  import CharacterMasteryGrid from '#lib/components/progress/CharacterMasteryGrid.svelte';
  import ConfusionList from '#lib/components/progress/ConfusionList.svelte';
  import PracticeActivity from '#lib/components/progress/PracticeActivity.svelte';
  import * as m from '#lib/paraglide/messages.js';

  let loading = $state(true);
  let loadError = $state(false);
  let summary = $state.raw<ProgressSummary | null>(null);
  let mounted = false;
  let loadVersion = 0;
  let activeDb: IDBDatabase | null = null;

  async function loadProgress() {
    const version = ++loadVersion;
    loading = true;
    loadError = false;
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      if (!mounted || version !== loadVersion) return;
      activeDb = db;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const [attempts, sessions] = await Promise.all([
        createAttemptRepository(db).getAttemptsByTimeRange(
          new Date(now - 60 * 86400000).toISOString(),
          nowIso
        ),
        createSessionRepository(db).getSessionsByTimeRange(
          new Date(now - 7 * 86400000).toISOString(),
          nowIso
        )
      ]);
      if (mounted && version === loadVersion)
        summary = summarizeProgress(attempts, sessions, nowIso);
    } catch (error) {
      if (mounted && version === loadVersion) {
        console.error('Failed to load progress data:', error);
        loadError = true;
      }
    } finally {
      if (db) closeTrainingDb(db);
      if (activeDb === db) activeDb = null;
      if (mounted && version === loadVersion) loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    void loadProgress();
    return () => {
      mounted = false;
      loadVersion++;
      if (activeDb) closeTrainingDb(activeDb);
    };
  });
</script>

<svelte:head>
  <title>{m.nav_progress()} · DitPath</title>
</svelte:head>

<div class="page-narrow">
  <div class="progress-container">
    <header class="progress-header">
      <div class="eyebrow">{m.nav_progress()}</div>
      <h1 class="page-title">{m.progress_title()}</h1>
      <p class="progress-subtitle">{m.progress_subtitle()}</p>
    </header>

    {#if loading}
      <div class="loading-card" role="status">
        <span class="sr-only">{m.common_loading()}</span>
        <div class="skeleton loading-card" aria-hidden="true"></div>
      </div>
    {:else if loadError}
      <div class="progress-section">
        <p role="alert">{m.progress_load_error()}</p>
        <button type="button" class="btn-primary" onclick={loadProgress}
          >{m.progress_retry()}</button
        >
      </div>
    {:else if summary}
      {#if !summary.hasRecentActivity}
        <section class="progress-section" aria-labelledby="empty-heading">
          <h2 id="empty-heading" class="section-title">{m.progress_empty_title()}</h2>
          <p class="progress-subtitle">{m.progress_empty_description()}</p>
          <a class="btn-primary" href={localizedHref('/morse/learn')}
            >{m.progress_return_course()}</a
          >
        </section>
      {:else}
        <PracticeActivity
          sessionCount={summary.sessionCount}
          totalMinutes={summary.totalMinutes}
          timedSessionCount={summary.timedSessionCount}
          accuracyPercent={summary.accuracyPercent}
        />

        <section class="progress-section" aria-labelledby="mastery-heading">
          <h2 id="mastery-heading" class="section-title">{m.progress_mastery_heading()}</h2>
          <CharacterMasteryGrid masteryMap={summary.masteryMap} />
        </section>

        <section class="progress-section" aria-labelledby="diagnostics-heading">
          <h2 id="diagnostics-heading" class="section-title">{m.progress_diagnostics_heading()}</h2>
          <ConfusionList confusionPairs={summary.confusionPairs} slowChars={summary.slowChars} />
        </section>
      {/if}
    {/if}
  </div>
</div>

<style>
  .progress-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    margin: 0 auto;
  }

  .progress-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .eyebrow {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--learning-current, var(--accent));
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .progress-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    max-width: 28rem;
    line-height: var(--leading-normal);
  }

  .progress-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .section-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
  }

  .loading-card {
    height: 16rem;
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }
</style>

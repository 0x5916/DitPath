<script lang="ts">
  import { onMount } from 'svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync,
    syncTrainingNow,
    importUnclaimedTraining,
    getUnclaimedTrainingCount
  } from '#lib/training-sync.ts';
  import { lang, localizedHref } from '#lib/i18n.svelte.ts';
  import { closeTrainingDb, openTrainingDb } from '#lib/data/training-db.ts';
  import { createAttemptRepository } from '#lib/data/attempt-repository.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import {
    sessionOccurredAt,
    summarizeProgress,
    type ProgressSummary
  } from '#lib/training/v2/progress-summary.ts';
  import type { HistorySessionRecord } from '#lib/training/v2/types.ts';
  import CharacterMasteryGrid from '#lib/components/progress/CharacterMasteryGrid.svelte';
  import ConfusionList from '#lib/components/progress/ConfusionList.svelte';
  import PracticeActivity from '#lib/components/progress/PracticeActivity.svelte';
  import * as m from '#lib/paraglide/messages.js';

  let loading = $state(true);
  let loadError = $state(false);
  let summary = $state.raw<ProgressSummary | null>(null);
  let history = $state.raw<HistorySessionRecord[]>([]);
  const dateFormat = $derived(
    new Intl.DateTimeFormat(lang.value, { dateStyle: 'medium', timeStyle: 'short' })
  );
  let mounted = false;
  let loadVersion = 0;
  let activeDb: IDBDatabase | null = null;
  let unclaimedCount = $state(0);
  let importing = $state(false);
  let importError = $state(false);

  async function loadProgress() {
    const owner = getTrainingOwner();
    const version = ++loadVersion;
    summary = null;
    history = [];
    loading = true;
    loadError = false;
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      if (!mounted || version !== loadVersion || owner !== getTrainingOwner()) return;
      activeDb = db;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const repository = createSessionRepository(db, owner);
      const [attempts, sessions, latestSessions] = await Promise.all([
        createAttemptRepository(db, owner).getAttemptsByTimeRange(
          new Date(now - 60 * 86400000).toISOString(),
          nowIso
        ),
        repository.getSessionsByTimeRange(new Date(now - 7 * 86400000).toISOString(), nowIso),
        repository.getSessions()
      ]);
      if (mounted && version === loadVersion && owner === getTrainingOwner()) {
        summary = summarizeProgress(attempts, sessions, nowIso);
        history = latestSessions.filter((session) => session.status !== 'in-progress').slice(0, 20);
      }
    } catch (error) {
      if (mounted && version === loadVersion && owner === getTrainingOwner()) {
        console.error('Failed to load progress data:', error);
        loadError = true;
      }
    } finally {
      if (db) closeTrainingDb(db);
      if (activeDb === db) activeDb = null;
      if (mounted && version === loadVersion && owner === getTrainingOwner()) loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    let revision = '';
    const unsubscribe = subscribeTrainingSync((state) => {
      const next = `${state.owner}:${state.version}`;
      if (revision === next) return;
      revision = next;
      void loadProgress();
      void getUnclaimedTrainingCount()
        .then((count) => {
          if (mounted) unclaimedCount = count;
        })
        .catch(() => {
          if (mounted) importError = true;
        });
    });
    return () => {
      unsubscribe();
      mounted = false;
      loadVersion++;
      if (activeDb) closeTrainingDb(activeDb);
    };
  });
  async function importHistory() {
    if (importing) return;
    importing = true;
    importError = false;
    try {
      await importUnclaimedTraining();
      unclaimedCount = await getUnclaimedTrainingCount();
    } catch {
      importError = true;
    } finally {
      importing = false;
    }
  }
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

    <TrainingSyncStatus
      owner={trainingSyncState.owner}
      pending={trainingSyncState.pending}
      syncing={trainingSyncState.syncing}
      synced={trainingSyncState.synced}
      error={trainingSyncState.error ?? (importError ? m.history_sync_error() : null)}
      onSync={() => void syncTrainingNow()}
      onImport={() => void importHistory()}
      {unclaimedCount}
      {importing}
    />

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
      {#if !summary.hasRecentActivity && history.length === 0}
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
          guidedSessionCount={summary.guidedSessionCount}
          practiceSessionCount={summary.practiceSessionCount}
          legacySessionCount={summary.legacySessionCount}
          totalMinutes={summary.totalMinutes}
          timedSessionCount={summary.timedSessionCount}
          accuracyPercent={summary.accuracyPercent}
        />

        {#if history.length > 0}
          <section class="progress-section" aria-labelledby="history-heading">
            <h2 id="history-heading" class="section-title">{m.progress_history_heading()}</h2>
            <p class="progress-subtitle">{m.history_unknown_hint()}</p>
            <div class="history-scroll">
              <table>
                <thead
                  ><tr>
                    <th scope="col">{m.progress_history_type()}</th>
                    <th scope="col">{m.history_status()}</th>
                    <th scope="col">{m.profile_history_lesson()}</th>
                    <th scope="col">{m.progress_history_speed()}</th>
                    <th scope="col">{m.profile_history_accuracy()}</th>
                    <th scope="col">{m.profile_history_date()}</th>
                  </tr></thead
                >
                <tbody>
                  {#each history as session (session.id)}
                    <tr>
                      <td
                        >{session.mode === 'practice'
                          ? m.progress_history_practice()
                          : session.mode === 'legacy'
                            ? m.history_legacy()
                            : m.progress_history_guided()}</td
                      >
                      <td
                        >{session.status === 'abandoned'
                          ? m.history_abandoned()
                          : m.history_completed()}</td
                      >
                      <td>{session.step ?? m.progress_unmeasured()}</td>
                      <td
                        >{session.charWpm ?? m.progress_unmeasured()} / {session.effWpm ??
                          m.progress_unmeasured()}</td
                      >
                      <td
                        >{session.accuracy == null
                          ? m.progress_unmeasured()
                          : m.progress_accuracy_value({
                              percent: Math.round(session.accuracy * 100)
                            })}</td
                      >
                      <td
                        ><time datetime={sessionOccurredAt(session)}
                          >{dateFormat.format(new Date(sessionOccurredAt(session)))}</time
                        ></td
                      >
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </section>
        {/if}

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
  .history-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  th,
  td {
    padding: var(--space-3);
    text-align: start;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--text-secondary);
    font-weight: 600;
  }

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

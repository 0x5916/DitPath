<script lang="ts">
  import { browser } from '$app/env';
  import { page } from '$app/state';
  const view = $derived(
    browser && ['characters', 'history'].includes(page.url.searchParams.get('view') ?? '')
      ? page.url.searchParams.get('view')
      : 'overview'
  );

  import LearningHistory from '#lib/components/learning/LearningHistory.svelte';
  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import LearningOverview from '#lib/components/learning/LearningOverview.svelte';
  const learning = createLearningView();
  import { onMount } from 'svelte';
  import { CircleCheck, CircleMinus, Dumbbell, History, Radio } from '@lucide/svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import InfoTip from '#lib/components/InfoTip.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync
  } from '#lib/training-sync.svelte.ts';
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
  import { LESSONS } from '#lib/training/sequence.ts';
  import CharacterMasteryGrid from '#lib/components/progress/CharacterMasteryGrid.svelte';
  import ConfusionList from '#lib/components/progress/ConfusionList.svelte';
  import PracticeActivity from '#lib/components/progress/PracticeActivity.svelte';
  import * as m from '#lib/paraglide/messages.js';
  import { recordedCharacters } from '#lib/training/targeted-review.ts';
  import {
    openLearningPilotDb,
    getLearningPilotHistory,
    type LearningPilotHistory
  } from '#lib/data/learning-pilot.ts';

  let showHistory = $state(false);
  let loading = $state(true);
  let loadError = $state(false);
  let summary = $state.raw<ProgressSummary | null>(null);
  let history = $state.raw<HistorySessionRecord[]>([]);
  let knownCharacters = $state.raw<string[]>([]);
  let reviewHistory = $state.raw<LearningPilotHistory[]>([]);
  let reviewHistoryError = $state(false);
  const dateFormat = $derived(
    new Intl.DateTimeFormat(lang.value, { dateStyle: 'medium', timeStyle: 'short' })
  );
  const percentFormat = $derived(
    new Intl.NumberFormat(lang.value, { style: 'percent', maximumFractionDigits: 0 })
  );
  let mounted = false;
  let loadVersion = 0;
  let loadedOwner: string | null = null;
  let activeDb: IDBDatabase | null = null;

  async function loadProgress() {
    const owner = getTrainingOwner();
    const version = ++loadVersion;
    // Background history updates replace the result only after they finish.
    if (owner !== loadedOwner) {
      loadedOwner = null;
      summary = null;
      history = [];
      knownCharacters = [];
      reviewHistory = [];
      showHistory = false;
      loading = true;
    }
    loadError = false;
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      if (!mounted || version !== loadVersion || owner !== getTrainingOwner()) return;
      activeDb = db;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const repository = createSessionRepository(db, owner);
      const [attempts, sessions, latestSessions, allAttempts] = await Promise.all([
        createAttemptRepository(db, owner).getAttemptsByTimeRange(
          new Date(now - 60 * 86400000).toISOString(),
          nowIso
        ),
        repository.getSessionsByTimeRange(new Date(now - 7 * 86400000).toISOString(), nowIso),
        repository.getSessions(),
        createAttemptRepository(db, owner).getAttemptsByTimeRange(
          '0001-01-01T00:00:00.000Z',
          nowIso
        )
      ]);
      if (mounted && version === loadVersion && owner === getTrainingOwner()) {
        knownCharacters = recordedCharacters(allAttempts);
        summary = summarizeProgress(attempts, sessions, nowIso);
        history = latestSessions.filter((session) => session.status !== 'in-progress').slice(0, 20);
        loadedOwner = owner;
        let pilotDb: IDBDatabase | null = null;
        try {
          pilotDb = await openLearningPilotDb();
          const reviews = await getLearningPilotHistory(pilotDb, owner);
          if (mounted && version === loadVersion && owner === getTrainingOwner()) {
            reviewHistory = reviews
              .filter(
                (review) => review.status !== 'in-progress' || review.completedPromptCount > 0
              )
              .slice(0, 10);
            reviewHistoryError = false;
          }
        } catch {
          if (mounted && version === loadVersion && owner === getTrainingOwner())
            reviewHistoryError = true;
        } finally {
          pilotDb?.close();
        }
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
    const stopLearning = learning.start();
    mounted = true;
    let revision = '';
    const unsubscribe = subscribeTrainingSync((state) => {
      const next = `${state.owner}:${state.version}`;
      if (revision === next) return;
      revision = next;
      void loadProgress();
    });
    return () => {
      unsubscribe();
      stopLearning();
      mounted = false;
      loadVersion++;
      if (activeDb) closeTrainingDb(activeDb);
    };
  });
</script>

<svelte:head>
  <title>{m.nav_progress()} · OpenCW</title>
</svelte:head>

<div class="progress-page">
  <div class="progress-container">
    <header class="progress-header">
      <h1 class="page-title">{m.nav_progress()}</h1>
    </header>
    <nav class="progress-tabs" aria-label={m.nav_progress()}>
      {#each ['overview', 'characters', 'history'] as tab (tab)}
        <a
          href={localizedHref(
            `/morse/progress?view=${tab}${browser && page.url.searchParams.has('status') ? `&status=${encodeURIComponent(page.url.searchParams.get('status')!)}` : ''}`
          )}
          aria-current={view === tab ? 'page' : undefined}
          >{tab === 'overview'
            ? m.progress_tab_overview()
            : tab === 'characters'
              ? m.progress_tab_characters()
              : m.progress_tab_history()}</a
        >
      {/each}
    </nav>

    {#if learning.snapshot && (learning.snapshot.knownCharacters.length >= 2 || view === 'characters')}<LearningOverview
        snapshot={learning.snapshot}
        details
        progressView={view}
      />{/if}
    {#if learning.failed}<p role="alert">{m.progress_load_error()}</p>
      <button class="btn-ghost" onclick={() => learning.refresh()}>{m.progress_retry()}</button
      >{/if}

    <TrainingSyncStatus
      owner={trainingSyncState.owner}
      pending={trainingSyncState.pending}
      syncing={trainingSyncState.syncing}
      synced={trainingSyncState.synced}
      error={trainingSyncState.error}
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
      {#if !summary.hasRecentActivity && history.length === 0 && reviewHistory.length === 0 && !learning.snapshot?.history.length}
        <section class="progress-section progress-empty" aria-labelledby="empty-heading">
          <h2 id="empty-heading" class="section-title">{m.progress_empty_title()}</h2>
          <p class="progress-subtitle">{m.progress_empty_description()}</p>
          <a class="btn-primary" href={localizedHref('/morse/learn')}
            >{m.progress_return_course()}</a
          >
        </section>
      {:else}
        {#if view === 'overview' && !learning.snapshot?.checks.length && (summary.confusionPairs.length > 0 || summary.slowChars.length > 0)}
          <section class="progress-section" aria-label={m.progress_attention()}>
            <ConfusionList
              confusionPairs={summary.confusionPairs}
              slowChars={summary.slowChars}
              {knownCharacters}
            />
          </section>
        {/if}

        {#if view === 'overview'}<PracticeActivity
            progressPage
            sessionCount={summary.sessionCount}
            guidedSessionCount={summary.guidedSessionCount}
            practiceSessionCount={summary.practiceSessionCount}
            legacySessionCount={summary.legacySessionCount}
            totalMinutes={summary.totalMinutes}
            timedSessionCount={summary.timedSessionCount}
            accuracyPercent={summary.accuracyPercent}
          />
        {/if}
        {#if view === 'overview' && learning.snapshot?.knownCharacters.length}
          <section class="recall-summary" aria-label={m.progress_tab_characters()}>
            {#each ['not-met', 'met', 'stale'] as criterion (criterion)}
              <a href={localizedHref(`/morse/progress?view=characters&status=${criterion}`)}>
                <span
                  >{criterion === 'met'
                    ? m.learning_current_met()
                    : criterion === 'not-met'
                      ? m.learning_current_notmet()
                      : m.learning_current_stale()}</span
                >
                <strong
                  >{learning.snapshot.characters.filter(
                    (c) =>
                      learning.snapshot?.knownCharacters.includes(c.character) &&
                      (criterion === 'stale'
                        ? !['met', 'not-met'].includes(c.current.criterion)
                        : c.current.criterion === criterion)
                  ).length}</strong
                >
              </a>
            {/each}
          </section>
        {/if}
        {#if view === 'history'}<details class="progress-section ui-disclosure">
            <summary>{m.progress_mastery_heading()}</summary>
            <p>{m.learning_legacy_hint()}</p>
            <CharacterMasteryGrid masteryMap={summary.masteryMap} />
          </details>

          {#if history.length > 0}
            <details class="progress-section ui-disclosure">
              <summary>{m.progress_history_heading()}</summary>
              <div class="history-heading">
                <InfoTip
                  label={m.common_tip_label({ topic: m.progress_history_heading() })}
                  text={m.history_unknown_hint()}
                />
              </div>
              <ol class="history-list" role="list">
                {#each showHistory ? history : history.slice(0, 5) as session (session.id)}
                  {@const introduced = LESSONS[session.step - 1]?.split('').join(', ')}
                  <li class="history-row">
                    <div class="session-summary">
                      <div class="session-copy">
                        <strong class="session-title">
                          {#if session.mode === 'practice'}
                            <Dumbbell size={18} class="practice-icon" aria-hidden="true" />
                            {m.progress_history_practice_lesson({ step: session.step })}
                          {:else if session.mode === 'legacy'}
                            <History size={18} aria-hidden="true" />
                            {m.progress_history_legacy_lesson({ step: session.step })}
                          {:else}
                            <Radio size={18} aria-hidden="true" />
                            {introduced
                              ? m.progress_history_lesson_characters({
                                  step: session.step,
                                  characters: introduced
                                })
                              : m.progress_history_lesson({ step: session.step })}
                          {/if}
                        </strong>
                        <time datetime={sessionOccurredAt(session)}
                          >{dateFormat.format(new Date(sessionOccurredAt(session)))}</time
                        >
                      </div>
                      <span class="session-status" class:abandoned={session.status === 'abandoned'}>
                        {#if session.status === 'abandoned'}
                          <CircleMinus size={14} aria-hidden="true" />{m.history_abandoned()}
                        {:else}
                          <CircleCheck size={14} aria-hidden="true" />{m.history_completed()}
                        {/if}
                      </span>
                    </div>
                    <dl class="session-metrics">
                      <div>
                        <dt>{m.profile_cw_char_wpm()}</dt>
                        <dd>{session.charWpm ?? m.progress_unmeasured()}</dd>
                      </div>
                      <div>
                        <dt>{m.profile_cw_eff_wpm()}</dt>
                        <dd>{session.effWpm ?? m.progress_unmeasured()}</dd>
                      </div>
                      <div>
                        <dt>{m.profile_history_accuracy()}</dt>
                        <dd>
                          {session.accuracy == null
                            ? m.progress_unmeasured()
                            : percentFormat.format(session.accuracy)}
                          {#if session.accuracy != null}
                            <span class="accuracy-bar" aria-hidden="true">
                              <span style:width={`${session.accuracy * 100}%`}></span>
                            </span>
                          {/if}
                        </dd>
                      </div>
                    </dl>
                  </li>
                {/each}
              </ol>
              {#if history.length > 5}
                <button
                  type="button"
                  class="btn-ghost history-toggle"
                  aria-expanded={showHistory}
                  onclick={() => (showHistory = !showHistory)}
                  >{showHistory ? m.common_show_less() : m.progress_show_history()}</button
                >
              {/if}
            </details>
          {/if}
        {/if}
      {/if}
    {/if}
    {#if view === 'history' && learning.snapshot?.history.length}<details
        class="progress-section ui-disclosure"
      >
        <summary>{m.history_learning()}</summary>
        <LearningHistory entries={learning.snapshot.history} />
      </details>{/if}

    {#if view === 'history' && (reviewHistory.length || reviewHistoryError)}
      <details class="progress-section ui-disclosure" open={reviewHistoryError}>
        <summary>{m.review_history_heading()}</summary>
        <p class="progress-subtitle">{m.review_local_only()}</p>
        {#if reviewHistoryError}<p role="alert">{m.progress_load_error()}</p>
          <button class="btn-ghost" onclick={loadProgress}>{m.progress_retry()}</button>{/if}
        <ol class="history-list">
          {#each reviewHistory as review (review.id)}
            <li class="history-row">
              <div class="session-summary">
                <strong
                  >{review.purpose === 'coaching'
                    ? m.review_title({ characters: review.targets.join(', ') })
                    : m.review_return_title()}</strong
                ><time datetime={review.completedAt ?? review.startedAt}
                  >{dateFormat.format(new Date(review.completedAt ?? review.startedAt))}</time
                ><span>{m.review_answer_count({ count: review.attempts.length })}</span>
              </div>
              <span
                >{review.status === 'completed'
                  ? m.review_result_title()
                  : m.review_unfinished()}</span
              >
            </li>
          {/each}
        </ol>
      </details>
    {/if}
  </div>
</div>

<style>
  .recall-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
  }
  .recall-summary a {
    display: grid;
    gap: var(--space-3);
    min-height: 48px;
    text-decoration: none;
    color: var(--text-secondary);
  }
  .recall-summary strong {
    color: var(--text-primary);
    font-size: var(--text-xl);
  }
  @media (max-width: 639px) {
    .recall-summary {
      grid-template-columns: 1fr;
    }
    .recall-summary a {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  }

  .progress-tabs {
    display: flex;
    gap: var(--space-4);
  }
  .progress-tabs a {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-inline: var(--space-3);
    color: var(--text-secondary);
    text-decoration: none;
    border-bottom: 2px solid transparent;
  }
  .progress-tabs a[aria-current] {
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  @media (max-width: 480px) {
    .progress-tabs {
      gap: 0;
    }
    .progress-tabs a {
      flex: 1;
      padding-inline: 4px;
      font-size: var(--text-sm);
    }
  }

  .history-toggle {
    align-self: flex-start;
    min-height: var(--answer-target-min);
  }
  .history-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .history-row {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--border);
  }
  .history-row:first-child {
    padding-top: 0;
  }
  .session-summary,
  .session-title,
  .session-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .session-summary {
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .session-title :global(svg) {
    flex-shrink: 0;
    color: var(--accent);
  }
  .session-title :global(.practice-icon) {
    color: var(--status-extra);
  }
  time,
  dt {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
  time {
    display: block;
    margin-top: var(--space-1);
  }
  .session-status {
    color: var(--status-good);
    font-size: var(--text-xs);
    gap: var(--space-1);
  }
  .session-status.abandoned {
    color: var(--status-ok);
  }
  .session-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  dd {
    margin: var(--space-1) 0 0;
    font-weight: 600;
  }
  .accuracy-bar {
    display: block;
    height: 4px;
    margin-top: var(--space-2);
    background: var(--border);
  }
  .accuracy-bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  @media (min-width: 680px) {
    .history-row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-6);
      align-items: center;
    }
  }

  .progress-page {
    max-width: 60rem;
    margin-inline: auto;
  }
  .progress-header h1 {
    font-size: 2rem;
    margin: 0;
  }
  .progress-empty {
    padding: var(--space-6);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    align-items: flex-start;
    gap: var(--space-4);
  }
  .progress-empty .btn-primary {
    min-height: 3.25rem;
    margin-top: var(--space-2);
  }
  .progress-container :global(.learning-history) {
    margin-block: var(--space-4) 0;
  }
  .progress-container :global(.learning-history > h2) {
    display: none;
  }
  @media (max-width: 639px) {
    .progress-page {
      padding-inline: var(--space-2);
    }
  }
  @media (min-width: 960px) {
    .progress-header h1 {
      font-size: 2.5rem;
    }
  }
  .progress-container {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-8);
    width: 100%;
    margin: 0 auto;
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    width: 100%;
    text-align: start;
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
    max-width: none;
  }

  .section-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
  }

  details.progress-section {
    display: block;
  }

  .history-heading {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .loading-card {
    height: 16rem;
    width: 100%;
    max-width: none;
  }
</style>

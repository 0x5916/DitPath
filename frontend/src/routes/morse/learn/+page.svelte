<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import { closeTrainingDb, openTrainingDb } from '#lib/data/training-db.ts';
  import { createSessionRepository, type SessionRepository } from '#lib/data/session-repository.ts';
  import { createAttemptRepository } from '#lib/data/attempt-repository.ts';
  import { migrateLegacyLocalStorage } from '#lib/data/legacy-migration.ts';
  import { getMasteryBlockers } from '#lib/training/v2/mastery.ts';
  import { deriveCourseGuidance } from '#lib/training/v2/course-guidance.ts';
  import {
    DEFAULT_MASTERY_POLICY as policy,
    type CharacterMastery,
    type TrainingSessionRecord
  } from '#lib/training/v2/types.ts';
  import LearnHero, { type HeroStateKind } from '#lib/components/learning/LearnHero.svelte';
  import CoursePath from '#lib/components/learning/CoursePath.svelte';
  import MorseSectionNav from '#lib/components/MorseSectionNav.svelte';
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import { user } from '#lib/auth.ts';
  import * as m from '#lib/paraglide/messages.js';

  let loading = $state(true);
  let errorMsg = $state('');
  let currentStep = $state(1);
  let suggestedStep = $state<number | undefined>(undefined);
  let inProgressSession = $state<TrainingSessionRecord | null>(null);
  let masteryMap = $state<Map<string, CharacterMastery>>(new Map());
  let reviewChars = $state<string[]>([]);
  let hasAttempts = $state(false);
  let courseComplete = $state(false);
  let mounted = false;
  let loadVersion = 0;
  let activeDb: IDBDatabase | null = null;
  let sessionRepo: SessionRepository | null = null;
  let sessionActionPending = $state(false);
  let sessionActionError = $state('');

  let heroKind = $derived.by<HeroStateKind>(() => {
    if (loading) return 'loading';
    if (errorMsg) return 'error';
    if (inProgressSession) return 'resume';
    if (reviewChars.length > 0) return 'review-due';
    if (courseComplete) return 'complete';
    if (currentStep === 1 && !hasAttempts) return 'new';
    return 'next';
  });

  let currentIntroduced = $derived(LESSONS[currentStep - 1] ?? 'KM');
  let masteryChecks = $derived(
    currentIntroduced.split('').flatMap((character) => {
      const mastery = masteryMap.get(character);
      if (!mastery) return [];
      const blockers = getMasteryBlockers(mastery);
      return blockers.length ? [{ character, mastery, blockers }] : [];
    })
  );

  async function loadLessons() {
    const version = ++loadVersion;
    loading = true;
    errorMsg = '';
    let db: IDBDatabase | null = null;
    let initialized = false;
    try {
      db = await openTrainingDb();
      if (!mounted || version !== loadVersion) return;
      activeDb = db;
      const migration = await migrateLegacyLocalStorage(db);
      if (!mounted || version !== loadVersion) return;
      const repository = createSessionRepository(db);
      const attemptRepo = createAttemptRepository(db);
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const [unfinished, recentAttempts, attemptCount] = await Promise.all([
        repository.getLatestInProgressSession(),
        attemptRepo.getAttemptsByTimeRange(new Date(now - 60 * 86400000).toISOString(), nowIso),
        attemptRepo.countAttempts()
      ]);
      if (!mounted || version !== loadVersion) return;
      const guidance = deriveCourseGuidance(recentAttempts, nowIso);
      currentStep = guidance.currentStep;
      masteryMap = new SvelteMap(guidance.masteryMap);
      reviewChars = guidance.reviewChars;
      courseComplete = guidance.courseComplete;
      hasAttempts = attemptCount > 0;
      inProgressSession = unfinished;
      suggestedStep = migration.suggestedStep > 1 ? migration.suggestedStep : undefined;
      sessionRepo = repository;
      initialized = true;
    } catch (error) {
      if (mounted && version === loadVersion) {
        console.error('Failed to load Learn home data:', error);
        errorMsg = m.learn_data_error_description();
      }
    } finally {
      if (!initialized && db) {
        closeTrainingDb(db);
        if (activeDb === db) activeDb = null;
      }
      if (mounted && version === loadVersion) loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    void loadLessons();
    return () => {
      mounted = false;
      loadVersion++;
      sessionRepo = null;
      if (activeDb) closeTrainingDb(activeDb);
    };
  });

  function handleStartLesson(step: number) {
    void goto(localizedHref(`/morse/learn/session?step=${step}`));
  }

  async function handleResumeSession() {
    const s = inProgressSession?.step ?? currentStep;
    if (!(await handleDiscardResume())) return;
    void goto(localizedHref(`/morse/learn/session?step=${s}`));
  }

  async function handleDiscardResume(): Promise<boolean> {
    if (!sessionRepo || !inProgressSession || sessionActionPending) return false;
    sessionActionPending = true;
    sessionActionError = '';
    try {
      await sessionRepo.updateSessionProgress(
        inProgressSession.id,
        inProgressSession.completedPromptCount,
        'abandoned',
        new Date().toISOString()
      );
      if (!mounted) return false;
      inProgressSession = null;
      return true;
    } catch {
      if (mounted) sessionActionError = m.learn_session_update_error();
      return false;
    } finally {
      if (mounted) sessionActionPending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.nav_learn()} · DitPath</title>
</svelte:head>

<div class="page-narrow">
  <div class="learn-home-container">
    <MorseSectionNav current="learn" />
    <header class="learn-header">
      <h1 class="page-title">{m.nav_learn()}</h1>
      <p class="learn-subtitle">{m.learn_subtitle()}</p>
    </header>

    <LearnHero
      kind={heroKind}
      step={inProgressSession?.step ?? currentStep}
      introducedChar={currentIntroduced}
      {reviewChars}
      resumableSessionId={inProgressSession?.id}
      errorMessage={errorMsg}
      {sessionActionPending}
      onStart={handleStartLesson}
      onResume={handleResumeSession}
      onDiscardResume={handleDiscardResume}
    />
    {#if errorMsg}
      <button type="button" class="btn-primary" onclick={loadLessons}>{m.progress_retry()}</button>
    {/if}
    {#if sessionActionError}<p role="alert">{sessionActionError}</p>{/if}

    {#if !loading && !errorMsg && (hasAttempts || inProgressSession) && masteryChecks.length > 0}
      <section aria-labelledby="unlock-checks-title">
        <h2 id="unlock-checks-title" class="section-title">
          {m.learn_unlock_checks_title({ characters: currentIntroduced.split('').join(', ') })}
        </h2>
        <p class="body-text">{m.learn_unlock_checks_hint()}</p>
        <ul class="mastery-checks" role="list">
          {#each masteryChecks as { character, mastery, blockers } (character)}
            <li>
              <strong>{character}</strong>
              {#each blockers as blocker (blocker)}
                <p class="body-text">
                  {#if blocker === 'attempts'}
                    {m.learn_unlock_attempts({
                      count: mastery.totalAttempts,
                      required: policy.minAttemptsForStability
                    })}
                  {:else if blocker === 'sessions'}
                    {m.learn_unlock_sessions({
                      count: mastery.sessionCount,
                      required: policy.minSessionsForStability
                    })}
                  {:else if blocker === 'accuracy'}
                    {m.learn_unlock_accuracy({
                      current: (mastery.rollingAccuracy * 100).toFixed(1),
                      required: Math.round(policy.targetAccuracy * 100)
                    })}
                  {:else if blocker === 'speed'}
                    {#if mastery.medianLatencyMs === null}
                      {m.learn_unlock_speed_unmeasured()}
                    {:else}
                      {m.learn_unlock_speed({
                        current: (Math.ceil(mastery.medianLatencyMs) / 1000).toFixed(3),
                        required: (policy.maxAutomaticLatencyMs / 1000).toFixed(3)
                      })}
                    {/if}
                  {:else}
                    {m.learn_unlock_review_due()}
                  {/if}
                </p>
              {/each}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if !$user}
      <GuestNotice class="body-text" />
    {/if}

    <section class="path-section" aria-labelledby="path-heading">
      <div class="section-header-row">
        <h2 id="path-heading" class="section-title">{m.learn_path_title()}</h2>
        {#if !loading && !errorMsg}
          <span class="path-meta">
            {m.learn_path_unlocked({ count: currentStep, total: LESSONS.length })}
          </span>
        {/if}
      </div>
      <p class="path-hint">{m.learn_path_hint()}</p>

      {#if !loading && !errorMsg}
        <CoursePath {currentStep} {masteryMap} {suggestedStep} onSelectStep={handleStartLesson} />
      {/if}
    </section>
  </div>
</div>

<style>
  .mastery-checks {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  .mastery-checks .body-text {
    margin: var(--space-1) 0 0;
  }

  .learn-home-container {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-6);
    width: 100%;
    margin: 0 auto;
  }

  .learn-header {
    text-align: left;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .learn-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    max-width: 28rem;
    line-height: var(--leading-normal);
  }

  .path-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .section-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
  }

  .path-meta {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .path-hint {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-secondary);
  }
</style>

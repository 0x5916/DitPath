<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { user } from '#lib/auth.ts';
  import { createAttemptRepository } from '#lib/data/attempt-repository.ts';
  import { migrateLegacyLocalStorage } from '#lib/data/legacy-migration.ts';
  import { createSessionRepository, type SessionRepository } from '#lib/data/session-repository.ts';
  import {
    listCheckpoints,
    discardCheckpoint,
    type SessionCheckpoint
  } from '#lib/data/session-checkpoints.ts';
  import { closeTrainingDb, openTrainingDb } from '#lib/data/training-db.ts';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import {
    getTrainingOwner,
    subscribeTrainingSync,
    trainingSyncState
  } from '#lib/training-sync.svelte.ts';
  import { deriveCourseGuidance } from '#lib/training/v2/course-guidance.ts';
  import { isRecommendationLessonLocked } from '#lib/training/v2/lesson-access.ts';
  import { getMasteryBlockers } from '#lib/training/v2/mastery.ts';
  import type { CharacterMastery, TrainingSessionRecord } from '#lib/training/v2/types.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import CoursePath from '#lib/components/learning/CoursePath.svelte';
  import LearnHero, { type HeroStateKind } from '#lib/components/learning/LearnHero.svelte';
  import LearningOverview from '#lib/components/learning/LearningOverview.svelte';
  import LessonRequirements from '#lib/components/learning/LessonRequirements.svelte';
  import SavedSessions from '#lib/components/learning/SavedSessions.svelte';
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';

  const learning = createLearningView();
  let loading = $state(true);
  let errorMsg = $state('');
  let currentStep = $state(1);
  let unlockedStep = $state(1);
  let suggestedStep = $state<number | undefined>(undefined);
  let savedSessions = $state.raw<SessionCheckpoint[]>([]);
  let inProgressSession = $state<TrainingSessionRecord | null>(null);
  let masteryMap = $state.raw<Map<string, CharacterMastery>>(new Map());
  let reviewChars = $state<string[]>([]);
  let hasAttempts = $state(false);
  let courseComplete = $state(false);
  let mounted = false;
  let loadVersion = 0;
  let activeDb: IDBDatabase | null = null;
  let sessionRepo: SessionRepository | null = null;
  let sessionActionPending = $state(false);
  let sessionActionError = $state('');
  let loadedOwner: string | null = null;

  async function discardSaved(entry: SessionCheckpoint) {
    if (sessionActionPending) return;
    sessionActionPending = true;
    const owner = getTrainingOwner();
    try {
      await discardCheckpoint(owner, entry);
      if (owner === getTrainingOwner()) await loadLessons();
    } catch {
      if (owner === getTrainingOwner()) sessionActionError = m.session_resume_error();
    } finally {
      if (owner === getTrainingOwner()) sessionActionPending = false;
    }
  }

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
  let activeStep = $derived(inProgressSession?.step ?? currentStep);
  let activeIntroduced = $derived(LESSONS[activeStep - 1] ?? 'KM');
  let unlockTitle = $derived(
    currentStep < LESSONS.length
      ? m.learn_unlock_next_title({
          step: currentStep + 1,
          characters: LESSONS[currentStep].split('').join(', ')
        })
      : m.learn_unlock_complete_title()
  );
  let masteryChecks = $derived(
    currentIntroduced.split('').flatMap((character) => {
      const mastery = masteryMap.get(character);
      return mastery && getMasteryBlockers(mastery).length ? [{ character, mastery }] : [];
    })
  );
  let recommendationLocked = $derived(
    learning.snapshot
      ? isRecommendationLessonLocked(learning.snapshot.recommendation.primary, unlockedStep)
      : false
  );

  async function loadLessons() {
    const owner = getTrainingOwner();
    if (loadedOwner !== owner) {
      loadedOwner = owner;
      savedSessions = [];
      sessionActionPending = false;
      sessionActionError = '';
    }
    const version = ++loadVersion;
    const current = () => mounted && version === loadVersion && owner === getTrainingOwner();
    if (activeDb) closeTrainingDb(activeDb);
    activeDb = null;
    sessionRepo = null;
    inProgressSession = null;
    masteryMap = new Map();
    reviewChars = [];
    hasAttempts = false;
    currentStep = 1;
    unlockedStep = 1;
    courseComplete = false;
    loading = true;
    errorMsg = '';
    let db: IDBDatabase | null = null;
    let initialized = false;
    try {
      db = await openTrainingDb();
      if (!current()) return;
      activeDb = db;
      const migration = await migrateLegacyLocalStorage(db);
      if (!current()) return;
      const repository = createSessionRepository(db, owner);
      const attemptRepo = createAttemptRepository(db, owner);
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const [unfinished, allAttempts, attemptCount, checkpoints] = await Promise.all([
        repository.getLatestInProgressSession(),
        attemptRepo.getAttemptsByTimeRange('0001-01-01T00:00:00.000Z', nowIso),
        attemptRepo.countAttempts(),
        listCheckpoints(owner)
      ]);
      if (!current()) return;
      const recentAttempts = allAttempts.filter(
        (attempt) => Date.parse(attempt.createdAt) >= now - 60 * 86400000
      );
      const guidance = deriveCourseGuidance(recentAttempts, nowIso, LESSONS, {
        history: allAttempts
      });
      currentStep = guidance.currentStep;
      unlockedStep = guidance.unlockedStep;
      masteryMap = guidance.masteryMap;
      reviewChars = guidance.reviewChars;
      courseComplete = guidance.courseComplete;
      hasAttempts = attemptCount > 0;
      savedSessions = checkpoints.filter((c) => c.kind === 'guided');
      inProgressSession =
        unfinished && !savedSessions.some((c) => c.id === unfinished.id) ? unfinished : null;
      suggestedStep =
        owner === 'unclaimed' && migration.suggestedStep > 1 ? migration.suggestedStep : undefined;
      sessionRepo = repository;
      initialized = true;
    } catch (error) {
      if (current()) {
        console.error('Failed to load Learn home data:', error);
        errorMsg = m.learn_data_error_description();
      }
    } finally {
      if (!initialized && db) {
        closeTrainingDb(db);
        if (activeDb === db) activeDb = null;
      }
      if (current()) loading = false;
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
      void loadLessons();
    });
    return () => {
      unsubscribe();
      stopLearning();
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
    const owner = getTrainingOwner();
    sessionActionPending = true;
    sessionActionError = '';
    try {
      await sessionRepo.updateSessionProgress(
        inProgressSession.id,
        inProgressSession.completedPromptCount,
        'abandoned'
      );
      if (!mounted || owner !== getTrainingOwner()) return false;
      inProgressSession = null;
      return true;
    } catch {
      if (mounted && owner === getTrainingOwner())
        sessionActionError = m.learn_session_update_error();
      return false;
    } finally {
      if (mounted && owner === getTrainingOwner()) sessionActionPending = false;
    }
  }
</script>

<svelte:head>
  <title>{m.nav_learn()} · OpenCW</title>
</svelte:head>

{#snippet currentLesson()}
  <SavedSessions
    entries={savedSessions}
    onDiscard={(entry) => void discardSaved(entry)}
    busy={sessionActionPending}
  />
  {#if learning.snapshot && learning.snapshot.knownCharacters.length >= 2 && !inProgressSession && activeStep === currentStep && !recommendationLocked}
    <LearningOverview snapshot={learning.snapshot} unlockedLesson={unlockedStep} />
  {:else}<LearnHero
      embedded
      kind={heroKind}
      step={activeStep}
      introducedChar={activeIntroduced}
      {reviewChars}
      resumableSessionId={inProgressSession?.id}
      errorMessage={errorMsg}
      {sessionActionPending}
      onStart={handleStartLesson}
      onResume={handleResumeSession}
      onDiscardResume={handleDiscardResume}
    />{/if}
  {#if errorMsg}
    <button type="button" class="btn-primary" onclick={loadLessons}>{m.progress_retry()}</button>
  {/if}
  {#if sessionActionError}<p role="alert">{sessionActionError}</p>{/if}
{/snippet}

{#snippet lessonRequirements()}
  {#if !loading && !errorMsg && activeStep === currentStep && masteryChecks.length > 0 && !learning.snapshot?.knownCharacters.length}
    <LessonRequirements {unlockTitle} checks={masteryChecks} />
  {/if}
{/snippet}

<div class="lessons-page">
  <div class="learn-home-container">
    <header class="learn-header">
      <h1 class="page-title">{m.nav_learn()}</h1>
      {#if !loading && !errorMsg}
        <span class="path-meta">
          {m.learn_path_unlocked({ count: currentStep, total: LESSONS.length })}
        </span>
      {/if}
    </header>

    <TrainingSyncStatus
      owner={trainingSyncState.owner}
      pending={trainingSyncState.pending}
      error={trainingSyncState.error}
      syncing={trainingSyncState.syncing}
      synced={trainingSyncState.synced}
    />

    <CoursePath
      {currentStep}
      {unlockedStep}
      {masteryMap}
      {suggestedStep}
      ready={!loading && !errorMsg}
      current={currentLesson}
      requirements={lessonRequirements}
      onSelectStep={handleStartLesson}
    />

    {#if !$user}
      <GuestNotice class="body-text" />
    {/if}
  </div>
</div>

<style>
  .lessons-page {
    width: 100%;
    max-width: 70rem;
    margin-inline: auto;
  }
  .learn-home-container :global(.saved-sessions) {
    margin-block: 0;
  }
  .learn-home-container :global(.saved-sessions h2) {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: var(--space-3);
  }
  .learn-home-container :global(.saved-sessions article) {
    margin-top: var(--space-6);
  }
  .learn-home-container :global(.learning-overview h2) {
    font-size: 2rem;
  }
  .learn-home-container :global(.body-text) {
    margin-top: var(--space-10);
    font-size: var(--text-sm);
    color: var(--text-secondary);
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
    flex-direction: column;
    text-align: left;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .page-title {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .path-meta {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  @media (min-width: 960px) {
    .page-title {
      font-size: 2.5rem;
    }
  }
</style>

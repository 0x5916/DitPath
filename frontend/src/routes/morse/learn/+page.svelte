<script lang="ts">
  import SavedSessions from '#lib/components/learning/SavedSessions.svelte';
  import {
    listCheckpoints,
    discardCheckpoint,
    type SessionCheckpoint
  } from '#lib/data/session-checkpoints.ts';
  let savedSessions = $state.raw<SessionCheckpoint[]>([]);
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

  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import LearningOverview from '#lib/components/learning/LearningOverview.svelte';
  const learning = createLearningView();
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { CircleAlert } from '@lucide/svelte';
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
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync
  } from '#lib/training-sync.svelte.ts';
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
  let loadedOwner: string | null = null;

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
      if (!mastery) return [];
      const blockers = getMasteryBlockers(mastery);
      return blockers.length ? [{ character, mastery, blockers }] : [];
    })
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
    if (activeDb) closeTrainingDb(activeDb);
    activeDb = null;
    sessionRepo = null;
    inProgressSession = null;
    masteryMap = new SvelteMap();
    reviewChars = [];
    hasAttempts = false;
    currentStep = 1;
    courseComplete = false;
    loading = true;
    errorMsg = '';
    let db: IDBDatabase | null = null;
    let initialized = false;
    try {
      db = await openTrainingDb();
      if (!mounted || version !== loadVersion || owner !== getTrainingOwner()) return;
      activeDb = db;
      const migration = await migrateLegacyLocalStorage(db);
      if (!mounted || version !== loadVersion || owner !== getTrainingOwner()) return;
      const repository = createSessionRepository(db, owner);
      const attemptRepo = createAttemptRepository(db, owner);
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const [unfinished, recentAttempts, attemptCount, checkpoints] = await Promise.all([
        repository.getLatestInProgressSession(),
        attemptRepo.getAttemptsByTimeRange(new Date(now - 60 * 86400000).toISOString(), nowIso),
        attemptRepo.countAttempts(),
        listCheckpoints(owner)
      ]);
      if (!mounted || version !== loadVersion || owner !== getTrainingOwner()) return;
      const guidance = deriveCourseGuidance(recentAttempts, nowIso);
      currentStep = guidance.currentStep;
      masteryMap = new SvelteMap(guidance.masteryMap);
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
      if (mounted && version === loadVersion && owner === getTrainingOwner()) {
        console.error('Failed to load Learn home data:', error);
        errorMsg = m.learn_data_error_description();
      }
    } finally {
      if (!initialized && db) {
        closeTrainingDb(db);
        if (activeDb === db) activeDb = null;
      }
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

{#snippet masteryCheck(label: string, value: string, current?: number, target?: number)}
  <div class="mastery-check">
    <div class="check-values"><span>{label}</span><strong>{value}</strong></div>
    {#if current !== undefined && target !== undefined}
      <progress aria-hidden="true" value={current} max={target}></progress>
    {/if}
  </div>
{/snippet}

{#snippet currentLesson()}
  <SavedSessions
    entries={savedSessions}
    onDiscard={(entry) => void discardSaved(entry)}
    busy={sessionActionPending}
  />
  {#if learning.snapshot && learning.snapshot.knownCharacters.length >= 2 && !inProgressSession && activeStep === currentStep}
    <LearningOverview snapshot={learning.snapshot} />
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
    <details
      class={['unlock-checks', (heroKind === 'new' || heroKind === 'next') && 'with-start-row']}
    >
      <summary>{unlockTitle}</summary>
      <p class="unlock-hint">{m.learn_unlock_checks_hint()}</p>
      <ul class="mastery-checks" role="list">
        {#each masteryChecks as { character, mastery, blockers } (character)}
          <li class="mastery-character">
            <strong class="check-character">{character}</strong>
            <div class="character-checks">
              {#each blockers as blocker (blocker)}
                {#if blocker === 'attempts'}
                  {@render masteryCheck(
                    m.learn_unlock_attempts_label(),
                    m.learn_unlock_count({
                      count: mastery.totalAttempts,
                      required: policy.minAttemptsForStability
                    }),
                    mastery.totalAttempts,
                    policy.minAttemptsForStability
                  )}
                {:else if blocker === 'sessions'}
                  {@render masteryCheck(
                    m.learn_unlock_sessions_label(),
                    m.learn_unlock_count({
                      count: mastery.sessionCount,
                      required: policy.minSessionsForStability
                    }),
                    mastery.sessionCount,
                    policy.minSessionsForStability
                  )}
                {:else if blocker === 'accuracy'}
                  {@render masteryCheck(
                    m.learn_unlock_accuracy_label(),
                    mastery.totalAttempts === 0
                      ? m.learn_unlock_accuracy_missing_value({
                          required: Math.round(policy.targetAccuracy * 100)
                        })
                      : m.learn_unlock_accuracy_value({
                          current: (mastery.rollingAccuracy * 100).toFixed(1),
                          required: Math.round(policy.targetAccuracy * 100)
                        }),
                    mastery.totalAttempts === 0 ? undefined : mastery.rollingAccuracy,
                    policy.targetAccuracy
                  )}
                {:else if blocker === 'speed'}
                  {@render masteryCheck(
                    m.learn_unlock_speed_label(),
                    mastery.medianLatencyMs === null
                      ? m.learn_unlock_speed_missing_value({
                          required: (policy.maxAutomaticLatencyMs / 1000).toFixed(3)
                        })
                      : m.learn_unlock_speed_value({
                          current: (Math.ceil(mastery.medianLatencyMs) / 1000).toFixed(3),
                          required: (policy.maxAutomaticLatencyMs / 1000).toFixed(3)
                        })
                  )}
                {:else}
                  <p class="review-check">
                    <CircleAlert size={16} aria-hidden="true" />{m.learn_unlock_review_due()}
                  </p>
                {/if}
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
{/snippet}

<div class="page-narrow">
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
      {masteryMap}
      {suggestedStep}
      displayStep={activeStep}
      ready={!loading && !errorMsg}
      showPrevious={activeStep === currentStep && !courseComplete}
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
  .unlock-checks.with-start-row {
    margin-inline-start: calc(
      var(--lesson-character-width, var(--answer-target-min)) + var(--space-3)
    );
  }

  @media (max-width: 399px) {
    .unlock-checks.with-start-row {
      margin-inline-start: 0;
    }
  }

  .unlock-checks summary {
    min-height: var(--answer-target-min);
    padding-block: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
  }

  .unlock-checks summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .unlock-hint {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .mastery-checks {
    display: grid;
    gap: var(--space-6);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .mastery-character {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
  }

  .check-character {
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .character-checks {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .check-values {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    overflow-wrap: anywhere;
  }

  .check-values strong {
    color: var(--text-primary);
    font-weight: 500;
  }

  .mastery-check progress {
    appearance: none;
    display: block;
    width: 100%;
    height: var(--space-1);
    margin-top: var(--space-2);
    border: 0;
    background: var(--border);
  }

  .mastery-check progress::-webkit-progress-bar {
    background: var(--border);
  }

  .mastery-check progress::-webkit-progress-value {
    background: var(--accent);
  }

  .mastery-check progress::-moz-progress-bar {
    background: var(--accent);
  }

  .review-check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
  }

  .review-check :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-1);
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
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .path-meta {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>

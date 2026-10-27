<script lang="ts">
  import {
    loadCheckpoint,
    saveCheckpoint,
    removeCheckpoint,
    claimSession,
    checkpointMetadata,
    type GuidedCheckpoint
  } from '#lib/data/session-checkpoints.ts';
  import type { EvidencePresentation } from '#lib/audio/evidence-engine.ts';
  import { browser } from '$app/env';
  import { page } from '$app/state';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { createEvidenceAudioEngine } from '#lib/audio/evidence-engine.ts';
  import {
    createLearningEvidenceRepository,
    openLearningEvidenceDb
  } from '#lib/data/learning-evidence.ts';
  import { createEvidenceSessionRepositories } from '#lib/data/evidence-session.ts';
  import {
    activeLearningProfile,
    loadLearningSnapshot,
    learningRecommendationHref
  } from '#lib/data/learning-snapshot.ts';
  import {
    buildMixedCheck,
    parseMixedTargets,
    type MixedCheckSession
  } from '#lib/training/learning-policy/mixed-plan.ts';
  import { createSessionId } from '#lib/training/v2/ids.ts';
  import MixedCheckPanel from '#lib/components/learning/MixedCheckPanel.svelte';
  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import { learningSyncState } from '#lib/learning-sync.svelte.ts';
  import { openTrainingDb } from '#lib/data/training-db.ts';
  import { createAttemptRepository } from '#lib/data/attempt-repository.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import { GuidedSessionController } from '#lib/training/v2/session-controller.svelte.ts';
  import type { InputMode } from '#lib/training/v2/types.ts';
  import SessionShell from '#lib/components/learning/SessionShell.svelte';
  import AudioPrompt from '#lib/components/learning/AudioPrompt.svelte';
  import RecognitionPrompt from '#lib/components/learning/RecognitionPrompt.svelte';
  import SessionResult from '#lib/components/learning/SessionResult.svelte';
  import ReviewPanel from '#lib/components/learning/ReviewPanel.svelte';
  import {
    buildReviewPlan,
    parseReviewRequest,
    type ReviewPlan
  } from '#lib/training/targeted-review.ts';
  import { readClientCwSettings } from '#lib/cwSync.ts';
  import { acceptsSessionContinue } from '#lib/components/learning/keyboard.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { LESSONS } from '#lib/training/sequence.ts';
  import { retainTrainingPersistence } from '#lib/pending-training-persistence.ts';
  import { AlertCircle, Check, Pause } from '@lucide/svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync
  } from '#lib/training-sync.svelte.ts';
  import { saveBeforeSessionNavigation, type PendingSessionNavigation } from './navigation';

  const learning = createLearningView();
  let mixedPlan = $state.raw<MixedCheckSession | null>(null);
  const checkValue = $derived(browser ? page.url.searchParams.get('check') : null);
  let controller = $state<GuidedSessionController | null>(null);
  let db: IDBDatabase | null = null;
  let initializing = $state(true);
  let initializationError = $state(false);
  let leaving = $state(false);
  let pendingAction = $state<'exit' | 'repeat' | 'next' | null>(null);
  let pendingNavigation = $state.raw<PendingSessionNavigation | null>(null);
  let bypassDestination: string | null = null;
  let allowUnload = false;
  let cancelHistoryRestore: (() => void) | null = null;
  let answerDraft = $state('');
  let onVisibility: (() => void) | null = null;
  let initialization = 0;
  let destroyed = false;
  let sessionKey: string | null = null;
  let reviewPlan = $state.raw<ReviewPlan | null>(null);
  let reviewStarted = $state(false);
  let reviewUnavailable = $state(false);
  let reviewRound = $state(0);
  const reviewValue = $derived(browser ? page.url.searchParams.get('review') : null);
  let resumeAfterExit = $state(false);
  let sessionOwner: string | null = null;
  const controllerOwners = new WeakMap<GuidedSessionController, string>();
  let discardPersistence = false;
  const suspendedControllers = new WeakSet<GuidedSessionController>();
  const sessionLeases = new WeakMap<GuidedSessionController, () => Promise<void>>();
  const resumeValue = $derived(browser ? page.url.searchParams.get('resume') : null);

  let step = $derived.by(() => {
    if (!browser) return 1;
    const s = page.url.searchParams.get('step');
    const parsed = s ? parseInt(s, 10) : 1;
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, LESSONS.length) : 1;
  });

  const routeKey = $derived(
    `${step}:${reviewValue ?? ''}:${checkValue ?? ''}:${resumeValue ?? ''}`
  );

  async function releaseSession(
    ctrl: GuidedSessionController | null,
    database: IDBDatabase | null,
    discard = false
  ) {
    if (!ctrl) {
      database?.close();
      return;
    }
    if (!suspendedControllers.has(ctrl)) ctrl.abandon();
    const cleanup = async () => {
      try {
        await ctrl.dispose();
      } finally {
        database?.close();
        await sessionLeases.get(ctrl)?.();
        sessionLeases.delete(ctrl);
      }
    };
    if (discard) await cleanup();
    else
      await retainTrainingPersistence({
        key: ctrl,
        owner: controllerOwners.get(ctrl) ?? getTrainingOwner(),
        save: () => ctrl.retryPersistence(),
        cleanup
      });
  }

  async function startSession(requestedStep: number, beginReview = false, continueSaved = true) {
    const requestedReview = reviewValue;
    const reviewRequest = parseReviewRequest(requestedReview);
    const requestedCheck = checkValue;
    const checkTargets = parseMixedTargets(requestedCheck);
    mixedPlan = null;
    reviewPlan = null;
    reviewUnavailable =
      (requestedReview !== null && !reviewRequest) ||
      (requestedCheck !== null && !checkTargets) ||
      (requestedReview !== null && requestedCheck !== null);
    reviewStarted = beginReview;
    answerDraft = '';
    const owner = getTrainingOwner();
    sessionOwner = owner;
    const generation = ++initialization;
    sessionKey = routeKey;
    discardPersistence = false;
    const previousController = controller;
    const previousDb = db;
    controller = null;
    db = null;
    initializing = true;
    initializationError = false;
    pendingAction = null;
    pendingNavigation = null;
    let database: IDBDatabase | null = null;
    let pendingLease: (() => Promise<void>) | null = null;
    try {
      await releaseSession(previousController, previousDb);
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) return;
      if (reviewUnavailable) return;
      database = await openTrainingDb();
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
        database.close();
        return;
      }
      let attemptRepo = createAttemptRepository(database, owner);
      let sessionRepo = createSessionRepository(database, owner);
      const recentAttempts = await attemptRepo.getAttemptsByTimeRange(
        new Date(Date.now() - 30 * 86400000).toISOString(),
        new Date().toISOString()
      );
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
        database.close();
        return;
      }
      const sound = readClientCwSettings();
      const loaded = continueSaved && resumeValue ? await loadCheckpoint(owner, resumeValue) : null;
      if (continueSaved && resumeValue && loaded?.kind !== 'guided')
        throw Error('Saved session unavailable');
      const resume = loaded?.kind === 'guided' ? loaded : null;
      const id = resume?.id ?? createSessionId();
      let firstPresentation: (id: string) => EvidencePresentation | null = () => null;
      let captureFirst: ((prompt: import('#lib/training/v2/types.ts').Prompt) => void) | undefined;
      let audio;
      if (resume) {
        pendingLease = await claimSession(owner, id, true);
        answerDraft = resume.draft;
        reviewPlan = resume.review;
        mixedPlan = resume.mixed;
        reviewStarted = true;
        if (resume.review || resume.mixed) {
          database.close();
          database = await openLearningEvidenceDb();
          const repo = createLearningEvidenceRepository(database, owner),
            records = await repo.all();
          if (records.some((r) => r.kind === 'terminal' && r.session_id === id)) {
            await removeCheckpoint(owner, id);
            throw Error('Saved session finalized');
          }
          const first = resume.first
            ? {
                ...resume.first,
                ...(resume.state.phase === 'feedback' ? {} : { valid: false, interrupted: true })
              }
            : null;
          audio = createEvidenceAudioEngine({
            ownerKey: owner,
            currentOwner: getTrainingOwner,
            source: resume.mixed
              ? 'mixed-check'
              : resume.review?.purpose === 'return-screening'
                ? 'screening'
                : 'coaching',
            sessionId: id,
            knownCharacters: checkpointMetadata(resume).knownCharacters,
            repository: repo
          });
          const adapted = createEvidenceSessionRepositories(
            repo,
            owner,
            checkpointMetadata(resume),
            audio,
            {
              session: resume.record,
              records,
              attempts: resume.state.attempts,
              first: first
                ? { promptId: resume.state.currentPrompt!.id, presentation: first }
                : undefined
            }
          );
          attemptRepo = adapted.attemptRepo;
          sessionRepo = adapted.sessionRepo;
          captureFirst = adapted.captureFirst;
          firstPresentation = adapted.firstPresentation;
        } else {
          const existing = await sessionRepo.getSession(id);
          if (existing && existing.status !== 'in-progress') {
            await removeCheckpoint(owner, id);
            throw Error('Saved session finalized');
          }
          if (!existing) await sessionRepo.saveSession(resume.record);
          audio = createEvidenceAudioEngine({
            ownerKey: owner,
            currentOwner: getTrainingOwner,
            source: 'guided'
          });
        }
      } else if (reviewRequest || checkTargets) {
        const snapshot = await loadLearningSnapshot({ ownerKey: owner });
        if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
          database.close();
          return;
        }
        const known = snapshot.knownCharacters;
        const targets = checkTargets ?? reviewRequest!.targets;
        if (
          !known.length ||
          targets.some((ch) => !known.includes(ch)) ||
          (checkTargets && known.length < 2)
        ) {
          reviewUnavailable = true;
          database.close();
          return;
        }
        if (checkTargets) {
          mixedPlan = buildMixedCheck({
            ownerKey: owner,
            targets: checkTargets,
            knownCharacters: known,
            profile: activeLearningProfile(sound.char_wpm),
            effWpm: Math.min(sound.char_wpm, sound.eff_wpm),
            freqHz: sound.freq,
            startedAt: new Date().toISOString(),
            checkId: id,
            reviewCycleIds: Object.fromEntries(
              snapshot.characters
                .filter((c) => checkTargets.includes(c.character) && c.reviewState)
                .map((c) => [c.character, c.reviewState!.cycleId])
            )
          });
        } else {
          reviewPlan = buildReviewPlan(reviewRequest!, known, {
            charWpm: sound.char_wpm,
            effWpm: Math.min(sound.char_wpm, sound.eff_wpm),
            freqHz: sound.freq
          });
        }
        database.close();
        database = null;
        if (!beginReview) return;
        pendingLease = await claimSession(owner, id);
        database = await openLearningEvidenceDb();
        if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
          database.close();
          return;
        }
        const purpose = mixedPlan
          ? 'mixed-check'
          : reviewPlan!.purpose === 'return-screening'
            ? 'screening'
            : 'coaching';
        const evidenceRepository = createLearningEvidenceRepository(database, owner);
        audio = createEvidenceAudioEngine({
          ownerKey: owner,
          currentOwner: getTrainingOwner,
          source: purpose,
          sessionId: id,
          knownCharacters: known,
          repository: evidenceRepository
        });
        const local = createEvidenceSessionRepositories(
          evidenceRepository,
          owner,
          {
            purpose,
            targets: mixedPlan?.plan.targets ?? reviewPlan!.targets,
            knownCharacters: known,
            prompts: mixedPlan?.prompts ?? reviewPlan!.prompts,
            profile: activeLearningProfile(sound.char_wpm),
            reviewCycleIds: mixedPlan?.plan.reviewCycleIds
          },
          audio
        );
        attemptRepo = local.attemptRepo;
        sessionRepo = local.sessionRepo;
        captureFirst = local.captureFirst;
        firstPresentation = local.firstPresentation;
      } else {
        pendingLease = await claimSession(owner, id);
        audio = createEvidenceAudioEngine({
          ownerKey: owner,
          currentOwner: getTrainingOwner,
          source: 'guided'
        });
      }
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
        await audio.dispose();
        database?.close();
        return;
      }
      const checkpointContext = {
        review: reviewPlan,
        mixed: mixedPlan,
        href: `/morse/learn/session?step=${requestedStep}${requestedReview ? `&review=${encodeURIComponent(requestedReview)}` : ''}${requestedCheck ? `&check=${encodeURIComponent(requestedCheck)}` : ''}`
      };
      const ctrl = new GuidedSessionController({
        ...(resume
          ? {
              resume: { state: resume.state, record: resume.record, draft: resume.draft },
              prompts: resume.state.prompts
            }
          : {}),
        saveCheckpoint: async (state, record, draft) => {
          if (['complete', 'abandoned'].includes(state.phase)) {
            await removeCheckpoint(owner, id);
            return;
          }
          const value: GuidedCheckpoint = {
            version: 1,
            kind: 'guided',
            id,
            href: checkpointContext.href,
            savedAt: new Date().toISOString(),
            draft,
            state,
            record,
            review: checkpointContext.review,
            mixed: checkpointContext.mixed,
            first: state.currentPrompt ? firstPresentation(state.currentPrompt.id) : null
          };
          await saveCheckpoint(owner, JSON.parse(JSON.stringify(value)));
        },
        sessionId: id,
        step: requestedStep,
        ...(mixedPlan
          ? {
              prompts: mixedPlan.prompts,
              allowProgression: false,
              feedback: 'after-check' as const
            }
          : reviewPlan
            ? { prompts: reviewPlan.prompts, allowProgression: false }
            : {}),
        audioEngine: audio,
        onPromptPlayback: captureFirst,
        attemptRepo,
        sessionRepo,
        allHistoricalAttempts: recentAttempts
      });
      if (pendingLease) {
        sessionLeases.set(ctrl, pendingLease);
        pendingLease = null;
      }
      controllerOwners.set(ctrl, owner);
      controller = ctrl;
      db = database;
      await ctrl.start();
    } catch (err) {
      database?.close();
      if (!destroyed && generation === initialization && owner === getTrainingOwner()) {
        initializationError = true;
        console.error('Failed to initialize guided session:', err);
      }
    } finally {
      await pendingLease?.();
      if (!destroyed && generation === initialization && owner === getTrainingOwner())
        initializing = false;
    }
  }

  onMount(() => {
    const stopLearning = learning.start();
    void startSession(step);
    onVisibility = () => controller?.handleVisibilityChange(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    const stopTraining = subscribeTrainingSync(() => {
      if (sessionOwner === null || sessionOwner === getTrainingOwner()) return;
      initialization++;
      pendingAction = null;
      pendingNavigation = null;
      resumeAfterExit = false;
      sessionOwner = getTrainingOwner();
      const previousController = controller;
      const previousDb = db;
      controller = null;
      db = null;
      initializing = false;
      initializationError = true;
      void releaseSession(previousController, previousDb, discardPersistence).catch((error) =>
        console.error('Session cleanup failed:', error)
      );
    });
    return () => {
      stopLearning();
      stopTraining();
    };
  });

  afterNavigate(() => {
    bypassDestination = null;
    allowUnload = false;
    if (sessionKey !== null && sessionKey !== routeKey) {
      reviewRound = 0;
      void startSession(step);
    }
  });

  onDestroy(() => {
    destroyed = true;
    initialization += 1;
    cancelHistoryRestore?.();
    if (onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    }
    // Svelte cleanup is synchronous. This owned promise closes storage after queued writes settle.
    void releaseSession(controller, db, discardPersistence).catch((err) =>
      console.error('Session cleanup failed:', err)
    );
    controller = null;
    db = null;
  });

  function waitForHistoryRestore(sourceHref: string): Promise<void> {
    if (window.location.href === sourceHref) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        window.removeEventListener('popstate', onPop);
        cancelHistoryRestore = null;
        resolve();
      };
      const onPop = () => {
        if (window.location.href === sourceHref) finish();
      };
      cancelHistoryRestore = finish;
      window.addEventListener('popstate', onPop);
    });
  }

  async function continueNavigation(navigation: PendingSessionNavigation, discard = false) {
    if (leaving || !controller) return;
    const owner = getTrainingOwner();
    const ctrl = controller;
    leaving = true;
    try {
      if (discard) discardPersistence = true;
      await saveBeforeSessionNavigation(ctrl, navigation, {
        discard,
        isActive: () => !destroyed && owner === getTrainingOwner() && controller === ctrl
      });
    } finally {
      leaving = false;
    }
  }

  beforeNavigate((navigation) => {
    if (allowUnload || (navigation.to && navigation.to.url.href === bypassDestination)) {
      bypassDestination = null;
      return;
    }
    const ctrl = controller;
    if (!ctrl) return;
    if (!navigation.to) {
      // A tab close/reload cannot be replayed asynchronously; the browser owns this decision.
      if (ctrl.persistenceStatus !== 'saved') navigation.cancel();
      return;
    }
    const source = navigation.from?.url ?? page.url;
    const target = navigation.to.url;
    if (source.pathname === target.pathname && source.search === target.search) return;
    if (ctrl.persistenceStatus === 'saved' && ['complete', 'abandoned'].includes(ctrl.phase))
      return;
    navigation.cancel();
    if (leaving) return;
    const delta = navigation.type === 'popstate' ? navigation.delta : null;
    const destination = target.href;
    const pending: PendingSessionNavigation = {
      restored: delta === null ? Promise.resolve() : waitForHistoryRestore(source.href),
      resume: () => {
        bypassDestination = destination;
        if (delta !== null) window.history.go(delta);
        else if (navigation.willUnload) {
          allowUnload = true;
          window.location.assign(destination);
        } else return goto(destination);
      }
    };
    pendingAction = null;
    pendingNavigation = pending;
    void continueNavigation(pending);
  });

  async function saveAndLeave() {
    const ctrl = controller,
      owner = getTrainingOwner();
    if (!ctrl || leaving) return;
    leaving = true;
    ctrl.suspend();
    try {
      if (!(await ctrl.flushPersistence()) || destroyed || owner !== getTrainingOwner()) return;
      suspendedControllers.add(ctrl);
      await releaseSession(ctrl, db);
      db = null;
      if (destroyed || owner !== getTrainingOwner()) return;
      controller = null;
      bypassDestination = new URL(localizedHref('/morse/learn'), page.url.href).href;
      await goto(bypassDestination);
    } finally {
      leaving = false;
    }
  }

  async function leaveSession(action: 'exit' | 'repeat' | 'next', discard = false) {
    if (leaving) return;
    leaving = true;
    pendingAction = action;
    pendingNavigation = null;
    const ctrl = controller;
    const owner = getTrainingOwner();
    const nextStep = (ctrl?.summary?.step ?? step) + 1;
    try {
      ctrl?.abandon();
      if (!discard && ctrl && !(await ctrl.flushPersistence())) return;
      if (destroyed || owner !== getTrainingOwner() || ctrl !== controller) return;
      discardPersistence = discard;
      await releaseSession(ctrl, db, discard);
      if (destroyed || owner !== getTrainingOwner() || ctrl !== controller) return;
      db = null;
      controller = null;
      if (action === 'repeat') {
        if (reviewPlan) reviewRound += 1;
        await startSession(step, Boolean(reviewPlan), false);
      } else {
        const destination = localizedHref(
          action === 'next'
            ? `/morse/learn/session?step=${nextStep}`
            : reviewPlan || mixedPlan
              ? '/morse/progress'
              : '/morse/learn'
        );
        bypassDestination = new URL(destination, page.url.href).href;
        await goto(destination);
      }
    } finally {
      leaving = false;
    }
  }

  async function retrySaving() {
    const ctrl = controller;
    const owner = getTrainingOwner();
    if (await ctrl?.retryPersistence()) {
      if (destroyed || owner !== getTrainingOwner() || ctrl !== controller) return;
      if (pendingNavigation) await continueNavigation(pendingNavigation);
      else if (pendingAction) await leaveSession(pendingAction);
    }
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!allowUnload && controller && controller.persistenceStatus !== 'saved') {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  function handleExit() {
    void leaveSession('exit');
  }

  function handlePauseToggle() {
    if (!controller) return;
    if (controller.phase === 'paused') {
      controller.resume();
    } else {
      controller.pause();
    }
  }

  function handleExitRequest() {
    if (!controller) return;
    resumeAfterExit = ['introducing', 'ready', 'playing', 'answering'].includes(controller.phase);
    controller.pause();
  }

  function handleExitCancel() {
    if (resumeAfterExit) controller?.resume();
    resumeAfterExit = false;
  }

  function handleSubmitAnswer(text: string, mode: InputMode) {
    if (!controller) return;
    if (controller.submitAnswer(text, mode)) answerDraft = '';
  }

  function handleContinue() {
    if (!controller) return;
    if (controller.continue()) answerDraft = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      leaving ||
      pendingAction ||
      pendingNavigation ||
      !controller ||
      !acceptsSessionContinue(event, controller.phase)
    )
      return;
    event.preventDefault();
    handleContinue();
  }

  function handleNextLesson() {
    void leaveSession('next');
  }

  function handleRepeatLesson() {
    void leaveSession('repeat');
  }
</script>

<svelte:window onkeydown={handleKeydown} onbeforeunload={handleBeforeUnload} />

<svelte:head>
  <title
    >{checkValue !== null
      ? m.mixed_title()
      : reviewValue !== null
        ? m.review_history_heading()
        : m.lesson_page_title({ step })}</title
  >
</svelte:head>

{#if reviewUnavailable}
  <main class="loading-stage">
    <div class="recovery-panel">
      <h1>{m.review_history_heading()}</h1>
      <p>{m.review_unavailable()}</p>
      <a class="btn-primary" href={localizedHref('/morse/learn')}>{m.home_all_lessons()}</a>
    </div>
  </main>
{:else if initializationError}
  <main class="loading-stage">
    <div class="recovery-panel" role="alert">
      <AlertCircle size={24} aria-hidden="true" />
      <p>{resumeValue ? m.session_resume_error() : m.lesson_initialization_error()}</p>
      <a class="btn-ghost" href={localizedHref('/morse/learn')}>{m.home_all_lessons()}</a>
      <button type="button" class="btn-primary" onclick={() => startSession(step)}
        >{m.lesson_retry_start()}</button
      >
    </div>
  </main>
{:else if mixedPlan && !reviewStarted && !initializing}
  <main class="loading-stage review-setup">
    <MixedCheckPanel
      plan={mixedPlan}
      onStart={() => startSession(step, true)}
      onFinish={handleExit}
    />
  </main>
{:else if reviewPlan && !reviewStarted && !initializing}
  <main class="loading-stage review-setup">
    <ReviewPanel
      plan={reviewPlan}
      onStart={() => startSession(step, true)}
      onRepeat={handleRepeatLesson}
      onFinish={handleExit}
    />
  </main>
{:else if !browser || initializing || !controller}
  <div class="loading-stage" role="status" aria-label={m.lesson_loading()}>
    <div class="skeleton loading-box"></div>
  </div>
{:else}
  {#snippet storageStatus()}
    {#if controller?.persistenceStatus === 'failed'}
      <div class="recovery-panel" role="alert">
        <AlertCircle size={20} aria-hidden="true" />
        <p>{m.lesson_save_failed()}</p>
        <button type="button" class="btn-primary" disabled={leaving} onclick={retrySaving}
          >{m.lesson_retry_save()}</button
        >
        {#if pendingAction || pendingNavigation}
          <p>{m.lesson_save_discard_hint()}</p>
          <button
            type="button"
            class="btn-ghost"
            disabled={leaving}
            onclick={() =>
              pendingNavigation
                ? continueNavigation(pendingNavigation, true)
                : pendingAction && leaveSession(pendingAction, true)}
            >{m.lesson_leave_unsaved()}</button
          >
        {/if}
      </div>
    {:else if controller?.persistenceStatus === 'saving'}
      <p class="save-status" role="status">{m.lesson_saving()}</p>
    {:else if controller?.persistenceStatus === 'saved'}
      {#if controller.phase === 'complete' && !reviewPlan && !mixedPlan}
        <p class="save-status" role="status">
          <Check size={18} aria-hidden="true" />{m.lesson_saved()}
        </p>
      {/if}
      {#if reviewPlan || mixedPlan}<TrainingSyncStatus
          expanded
          owner={learningSyncState.owner}
          pending={learningSyncState.pending}
          error={learningSyncState.error}
          syncing={learningSyncState.syncing}
          synced={learningSyncState.synced}
        />{:else}<TrainingSyncStatus
          owner={trainingSyncState.owner}
          pending={trainingSyncState.pending}
          error={trainingSyncState.error}
          syncing={trainingSyncState.syncing}
          synced={trainingSyncState.synced && ['complete', 'abandoned'].includes(controller.phase)}
        />{/if}
    {/if}
  {/snippet}

  <SessionShell
    review={Boolean(reviewPlan || mixedPlan)}
    assessment={Boolean(mixedPlan)}
    currentPromptIndex={controller.currentPromptIndex}
    totalPrompts={controller.totalPrompts}
    isPaused={controller.phase === 'paused'}
    complete={controller.phase === 'complete'}
    busy={leaving || (controller.phase === 'complete' && controller.persistenceStatus === 'saving')}
    canPause={!leaving &&
      ['introducing', 'ready', 'playing', 'answering', 'paused'].includes(controller.phase)}
    onSaveLeave={() => void saveAndLeave()}
    onExit={handleExit}
    onExitRequest={handleExitRequest}
    onExitCancel={handleExitCancel}
    onPauseToggle={handlePauseToggle}
  >
    {#if controller.phase !== 'complete'}{@render storageStatus()}{/if}
    {#if controller.phase === 'paused' && !resumeAfterExit}
      <div class="paused-banner">
        <Pause size={28} aria-hidden="true" />
        <h1
          tabindex="-1"
          {@attach (heading) => {
            heading.focus();
          }}
        >
          {m.lesson_paused()}
        </h1>
        <p>{m.lesson_pause_hint()}</p>
        <button type="button" class="btn-primary" onclick={() => controller?.resume()}>
          {m.lesson_resume()}
        </button>
      </div>
    {:else if controller.phase === 'complete' && controller.summary}
      {#if mixedPlan}<MixedCheckPanel
          plan={mixedPlan}
          finished
          snapshot={learning.snapshot}
          onRepeatCheck={learning.snapshot &&
          learningRecommendationHref(
            learning.snapshot.recommendation.primary,
            learning.snapshot.knownCharacters
          ) === `/morse/learn/session?check=${checkValue}`
            ? () => startSession(step, true, false)
            : undefined}
          result={learning.snapshot?.checks.find((c) => c.id === controller?.state.sessionId) ??
            null}
          busy={leaving || controller.persistenceStatus === 'saving'}
          {storageStatus}
          onStart={() => {}}
          onFinish={handleExit}
        />
      {:else if reviewPlan}<ReviewPanel
          plan={reviewPlan}
          attempts={controller.attempts}
          status={controller.persistenceStatus}
          busy={leaving}
          round={reviewRound}
          {storageStatus}
          onStart={() => {}}
          onRepeat={handleRepeatLesson}
          onFinish={handleExit}
        />
      {:else}<SessionResult
          summary={controller.summary}
          persistenceStatus={controller.persistenceStatus}
          busy={leaving}
          {storageStatus}
          onNextLesson={handleNextLesson}
          onRepeatLesson={handleRepeatLesson}
          onFinish={handleExit}
        />{/if}
    {:else if controller.currentPrompt && ['unscored-match', 'contrast', 'recall', 'short-group'].includes(controller.currentPrompt.spec.kind) && ['ready', 'playing', 'answering', 'feedback', 'paused'].includes(controller.phase)}
      {#key controller.currentPrompt.id}
        <RecognitionPrompt
          phase={controller.phase}
          typed={['recall', 'short-group'].includes(controller.currentPrompt.spec.kind)}
          scored={controller.currentPrompt.isScored}
          coaching={Boolean(reviewPlan)}
          assessment={Boolean(mixedPlan)}
          firstRecall={!reviewPlan &&
            !mixedPlan &&
            controller.currentPromptIndex ===
              controller.state.prompts.findIndex((prompt) => prompt.spec.kind === 'recall')}
          bind:draft={
            () => answerDraft,
            (value) => {
              answerDraft = value;
              controller?.setDraft(value);
            }
          }
          classification={controller.lastAttempt?.classification}
          options={controller.currentPrompt.spec.options ?? []}
          expected={controller.currentPrompt.spec.expectedText}
          entered={controller.lastAttempt?.enteredText}
          isCorrect={controller.lastAttempt?.isCorrect}
          playingCharacter={controller.feedbackCharacter}
          audioError={controller.state.audioError}
          onPlay={() => controller?.play()}
          onReplay={() => controller?.replay()}
          onSelect={(ch) => handleSubmitAnswer(ch, 'grid')}
          onSubmit={handleSubmitAnswer}
          onHear={(ch) => controller?.playFeedback(ch)}
          onContinue={handleContinue}
        />
        {#if mixedPlan && controller.phase === 'answering'}<button
            type="button"
            class="btn-ghost"
            onclick={() => handleSubmitAnswer('', 'keyboard')}>{m.mixed_skip()}</button
          >{/if}
      {/key}
    {:else if controller.currentPrompt?.spec.kind === 'introduction' && !['abandoned', 'idle'].includes(controller.phase)}
      <AudioPrompt
        phase={controller.phase}
        audioError={controller.state.audioError}
        isIntro
        introCharacter={controller.currentPrompt.spec.expectedText}
        introPlayed={controller.state.answerReadyAtMs !== null}
        onContinue={handleContinue}
        onPlay={() => controller?.play()}
        onReplay={() => controller?.replay()}
      />
    {/if}
    {#if controller.feedbackAudioError}
      <p role="alert">{m.lesson_feedback_audio_error()}</p>
    {/if}
  </SessionShell>
{/if}

<style>
  .loading-stage {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-base);
  }

  .review-setup {
    padding: var(--space-8) max(var(--space-4), env(safe-area-inset-right, 0px)) var(--space-8)
      max(var(--space-4), env(safe-area-inset-left, 0px));
  }

  .recovery-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 28rem;
    margin: var(--space-4) 0;
    padding: var(--space-4);
    border: 1px solid var(--status-bad);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    text-align: center;
  }

  .recovery-panel p {
    margin: 0;
  }
  .recovery-panel button {
    min-height: 3rem;
  }

  .loading-box {
    width: 20rem;
    height: 14rem;
  }

  .save-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0;
  }
  .save-status :global(svg) {
    color: var(--status-good);
  }
  .paused-banner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    width: 100%;
    max-width: 30rem;
    min-height: min(36rem, calc(100dvh - 8rem));
    padding-block: var(--space-8);
  }
  .paused-banner h1 {
    margin: 0;
    font-size: var(--text-2xl);
  }
  .paused-banner h1:focus {
    outline: none;
  }
  .paused-banner p {
    margin: 0;
    max-width: 24rem;
    color: var(--text-secondary);
  }
  .paused-banner button {
    margin-top: auto;
    min-height: 3.5rem;
    width: 100%;
  }
</style>

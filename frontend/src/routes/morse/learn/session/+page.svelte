<script lang="ts">
  import { browser } from '$app/env';
  import { page } from '$app/state';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { createWebAudioEngine } from '#lib/audio/engine.ts';
  import { openTrainingDb } from '#lib/data/training-db.ts';
  import { createAttemptRepository } from '#lib/data/attempt-repository.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import { GuidedSessionController } from '#lib/training/v2/session-controller.svelte.ts';
  import type { InputMode } from '#lib/training/v2/types.ts';
  import SessionShell from '#lib/components/learning/SessionShell.svelte';
  import AudioPrompt from '#lib/components/learning/AudioPrompt.svelte';
  import AnswerInput from '#lib/components/learning/AnswerInput.svelte';
  import CharacterGrid from '#lib/components/learning/CharacterGrid.svelte';
  import PromptFeedback from '#lib/components/learning/PromptFeedback.svelte';
  import ContrastRepair from '#lib/components/learning/ContrastRepair.svelte';
  import SessionResult from '#lib/components/learning/SessionResult.svelte';
  import { acceptsSessionContinue } from '#lib/components/learning/keyboard.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { LESSONS } from '#lib/training/sequence.ts';
  import { retainTrainingPersistence } from '#lib/pending-training-persistence.ts';
  import { AlertCircle } from '@lucide/svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync
  } from '#lib/training-sync.svelte.ts';
  import { saveBeforeSessionNavigation, type PendingSessionNavigation } from './navigation';

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
  let comparingContrast = $state(false);
  let onVisibility: (() => void) | null = null;
  let initialization = 0;
  let destroyed = false;
  let sessionStep: number | null = null;
  let resumeAfterExit = $state(false);
  let sessionOwner: string | null = null;
  const controllerOwners = new WeakMap<GuidedSessionController, string>();
  let discardPersistence = false;

  let step = $derived.by(() => {
    if (!browser) return 1;
    const s = page.url.searchParams.get('step');
    const parsed = s ? parseInt(s, 10) : 1;
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, LESSONS.length) : 1;
  });

  async function releaseSession(
    ctrl: GuidedSessionController | null,
    database: IDBDatabase | null,
    discard = false
  ) {
    if (!ctrl) {
      database?.close();
      return;
    }
    ctrl.abandon();
    const cleanup = async () => {
      try {
        await ctrl.dispose();
      } finally {
        database?.close();
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

  async function startSession(requestedStep: number) {
    const owner = getTrainingOwner();
    sessionOwner = owner;
    const generation = ++initialization;
    sessionStep = requestedStep;
    discardPersistence = false;
    const previousController = controller;
    const previousDb = db;
    controller = null;
    db = null;
    initializing = true;
    initializationError = false;
    pendingAction = null;
    pendingNavigation = null;
    comparingContrast = false;
    let database: IDBDatabase | null = null;
    try {
      await releaseSession(previousController, previousDb);
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) return;
      database = await openTrainingDb();
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
        database.close();
        return;
      }
      const attemptRepo = createAttemptRepository(database, owner);
      const sessionRepo = createSessionRepository(database, owner);
      const recentAttempts = await attemptRepo.getAttemptsByTimeRange(
        new Date(Date.now() - 30 * 86400000).toISOString(),
        new Date().toISOString()
      );
      if (destroyed || generation !== initialization || owner !== getTrainingOwner()) {
        database.close();
        return;
      }
      const ctrl = new GuidedSessionController({
        step: requestedStep,
        audioEngine: createWebAudioEngine(),
        attemptRepo,
        sessionRepo,
        allHistoricalAttempts: recentAttempts
      });
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
      if (!destroyed && generation === initialization && owner === getTrainingOwner())
        initializing = false;
    }
  }

  onMount(() => {
    void startSession(step);
    onVisibility = () => controller?.handleVisibilityChange(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return subscribeTrainingSync(() => {
      if (sessionOwner === null || sessionOwner === getTrainingOwner()) return;
      initialization++;
      pendingAction = null;
      pendingNavigation = null;
      comparingContrast = false;
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
  });

  afterNavigate(() => {
    bypassDestination = null;
    allowUnload = false;
    if (sessionStep !== null && sessionStep !== step) void startSession(step);
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
      if (action === 'repeat') await startSession(step);
      else {
        const destination = localizedHref(
          action === 'next' ? `/morse/learn/session?step=${nextStep}` : '/morse/learn'
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
    controller.submitAnswer(text, mode);
  }

  function handleContinue() {
    if (!controller) return;
    comparingContrast = false;
    controller.continue();
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
  <title>{m.lesson_page_title({ step })}</title>
</svelte:head>

{#if initializationError}
  <main class="loading-stage">
    <div class="recovery-panel" role="alert">
      <AlertCircle size={24} aria-hidden="true" />
      <p>{m.lesson_initialization_error()}</p>
      <button type="button" class="btn-primary" onclick={() => startSession(step)}
        >{m.lesson_retry_start()}</button
      >
    </div>
  </main>
{:else if !browser || initializing || !controller}
  <div class="loading-stage" role="status" aria-label={m.lesson_loading()}>
    <div class="skeleton loading-box"></div>
  </div>
{:else}
  <SessionShell
    currentPromptIndex={controller.currentPromptIndex}
    totalPrompts={controller.totalPrompts}
    isPaused={controller.phase === 'paused'}
    canPause={!leaving &&
      ['introducing', 'ready', 'playing', 'answering', 'paused'].includes(controller.phase)}
    onExit={handleExit}
    onExitRequest={handleExitRequest}
    onExitCancel={handleExitCancel}
    onPauseToggle={handlePauseToggle}
  >
    {#if controller.persistenceStatus === 'saved'}
      <TrainingSyncStatus
        owner={trainingSyncState.owner}
        pending={trainingSyncState.pending}
        error={trainingSyncState.error}
        syncing={trainingSyncState.syncing}
        synced={trainingSyncState.synced && ['complete', 'abandoned'].includes(controller.phase)}
      />
    {/if}
    {#if controller.persistenceStatus === 'failed'}
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
    {:else if controller.persistenceStatus === 'saving' && controller.phase !== 'complete'}
      <p role="status">{m.lesson_saving()}</p>
    {/if}
    {#if controller.phase === 'paused' && !resumeAfterExit}
      <div class="paused-banner">
        <h2>{m.lesson_paused()}</h2>
        <button type="button" class="btn-primary" onclick={() => controller?.resume()}>
          {m.lesson_resume()}
        </button>
      </div>
    {:else if controller.phase === 'complete' && controller.summary}
      <SessionResult
        summary={controller.summary}
        persistenceStatus={controller.persistenceStatus}
        busy={leaving}
        onNextLesson={handleNextLesson}
        onRepeatLesson={handleRepeatLesson}
        onFinish={handleExit}
      />
    {:else if comparingContrast && controller.currentPrompt && controller.lastAttempt}
      <ContrastRepair
        charA={controller.currentPrompt.spec.expectedText}
        charB={controller.lastAttempt.enteredText}
        playingCharacter={controller.feedbackCharacter}
        onPlayA={() => controller?.playFeedback(controller.currentPrompt!.spec.expectedText)}
        onPlayB={() => controller?.playFeedback(controller.lastAttempt!.enteredText)}
        onContinue={handleContinue}
      />
    {:else if controller.phase === 'feedback' && controller.lastAttempt && controller.currentPrompt}
      <PromptFeedback
        classification={controller.lastAttempt.classification}
        isCorrect={controller.lastAttempt.isCorrect}
        playingCharacter={controller.feedbackCharacter}
        expected={controller.currentPrompt.spec.expectedText}
        entered={controller.lastAttempt.enteredText}
        onContinue={handleContinue}
        onPlayExpected={() => controller?.playFeedback(controller.currentPrompt!.spec.expectedText)}
        onCompare={() => (comparingContrast = true)}
      />
    {:else if controller.currentPrompt && !['abandoned', 'idle'].includes(controller.phase)}
      <div class="prompt-stage">
        <AudioPrompt
          phase={controller.phase}
          replayCount={controller.replayCount}
          audioError={controller.state.audioError}
          isIntro={controller.currentPrompt.spec.kind === 'introduction'}
          introCharacter={controller.currentPrompt.spec.expectedText}
          onPlay={() => controller?.play()}
          onReplay={() => controller?.replay()}
        />

        {#if controller.currentPrompt.spec.kind === 'introduction'}
          <div class="intro-actions">
            <button
              type="button"
              class="btn-primary"
              disabled={controller.phase !== 'introducing'}
              aria-keyshortcuts="Enter"
              onclick={handleContinue}
            >
              {m.lesson_continue()} <kbd aria-hidden="true">Enter</kbd>
            </button>
          </div>
        {:else if controller.currentPrompt.spec.options && controller.currentPrompt.spec.options.length > 0}
          <CharacterGrid
            options={controller.currentPrompt.spec.options}
            disabled={controller.phase !== 'answering'}
            onSelect={(ch) => handleSubmitAnswer(ch, 'grid')}
          />
        {:else}
          {#key controller.currentPrompt.id}
            <AnswerInput
              disabled={controller.phase !== 'answering'}
              expectedLength={controller.currentPrompt.spec.expectedText.length}
              onSubmit={(text, mode) => handleSubmitAnswer(text, mode)}
            />
          {/key}
        {/if}
      </div>
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

  .prompt-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  .intro-actions {
    margin-top: var(--space-4);
  }

  .intro-actions button {
    min-height: var(--answer-target-min);
  }

  .paused-banner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }

  .paused-banner h2 {
    margin: 0;
    font-size: var(--text-xl);
    color: var(--text-primary);
  }
</style>

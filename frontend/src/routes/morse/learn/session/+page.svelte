<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { afterNavigate, goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { localizedHref } from '$lib/i18n.svelte';
  import { createWebAudioEngine } from '$lib/audio/engine';
  import { openTrainingDb } from '$lib/data/training-db';
  import { createAttemptRepository } from '$lib/data/attempt-repository';
  import { createSessionRepository } from '$lib/data/session-repository';
  import { GuidedSessionController } from '$lib/training/v2/session-controller.svelte';
  import type { InputMode } from '$lib/training/v2/types';
  import SessionShell from '$lib/components/learning/SessionShell.svelte';
  import AudioPrompt from '$lib/components/learning/AudioPrompt.svelte';
  import AnswerInput from '$lib/components/learning/AnswerInput.svelte';
  import CharacterGrid from '$lib/components/learning/CharacterGrid.svelte';
  import PromptFeedback from '$lib/components/learning/PromptFeedback.svelte';
  import ContrastRepair from '$lib/components/learning/ContrastRepair.svelte';
  import SessionResult from '$lib/components/learning/SessionResult.svelte';
  import { acceptsSessionContinue } from '$lib/components/learning/keyboard';
  import * as m from '$lib/paraglide/messages';
  import { LESSONS } from '$lib/training/sequence';

  let controller = $state<GuidedSessionController | null>(null);
  let db = $state<IDBDatabase | null>(null);
  let comparingContrast = $state(false);
  let onVisibility: (() => void) | null = null;
  let initialization = 0;
  let destroyed = false;
  let sessionStep: number | null = null;
  let resumeAfterExit = $state(false);

  let step = $derived.by(() => {
    if (!browser) return 1;
    const s = page.url.searchParams.get('step');
    const parsed = s ? parseInt(s, 10) : 1;
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, LESSONS.length) : 1;
  });

  async function startSession(requestedStep: number) {
    const generation = ++initialization;
    sessionStep = requestedStep;
    if (controller && controller.phase !== 'complete') controller.abandon();
    controller?.dispose();
    controller = null;
    comparingContrast = false;
    try {
      const database = db ?? (await openTrainingDb());
      if (destroyed || generation !== initialization) {
        if (database !== db) database.close();
        return;
      }
      db = database;

      const attemptRepo = createAttemptRepository(database);
      const sessionRepo = createSessionRepository(database);

      // Load recent attempts to provide historical context for scheduler and progression
      const recentAttempts = await attemptRepo.getAttemptsByTimeRange(
        new Date(Date.now() - 30 * 86400000).toISOString(),
        new Date().toISOString()
      );
      if (destroyed || generation !== initialization) return;

      const ctrl = new GuidedSessionController({
        step: requestedStep,
        audioEngine: createWebAudioEngine(),
        attemptRepo,
        sessionRepo,
        allHistoricalAttempts: recentAttempts
      });

      controller = ctrl;
      await ctrl.start();
    } catch (err) {
      console.error('Failed to initialize guided session:', err);
    }
  }

  onMount(() => {
    void startSession(step);
    onVisibility = () => controller?.handleVisibilityChange(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
  });

  afterNavigate(() => {
    if (sessionStep !== null && sessionStep !== step) void startSession(step);
  });

  onDestroy(() => {
    destroyed = true;
    initialization += 1;
    if (onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    }
    if (controller) {
      controller.dispose();
      controller = null;
    }
    if (db) {
      db.close();
      db = null;
    }
  });

  function handleExit() {
    if (controller) {
      controller.abandon();
    }
    void goto(localizedHref('/morse/learn'));
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
    if (!controller || !acceptsSessionContinue(event, controller.phase)) return;
    event.preventDefault();
    handleContinue();
  }

  function handleNextLesson() {
    const nextStep = (controller?.summary?.step ?? step) + 1;
    void goto(localizedHref(`/morse/learn/session?step=${nextStep}`));
  }

  function handleRepeatLesson() {
    void startSession(step);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <title>Lesson {step} · DitPath</title>
</svelte:head>

{#if !browser || !controller}
  <div class="loading-stage">
    <div class="skeleton loading-box"></div>
  </div>
{:else}
  <SessionShell
    currentPromptIndex={controller.currentPromptIndex}
    totalPrompts={controller.totalPrompts}
    isPaused={controller.phase === 'paused'}
    canPause={['introducing', 'ready', 'playing', 'answering', 'paused'].includes(controller.phase)}
    onExit={handleExit}
    onExitRequest={handleExitRequest}
    onExitCancel={handleExitCancel}
    onPauseToggle={handlePauseToggle}
  >
    {#if controller.phase === 'paused' && !resumeAfterExit}
      <div class="paused-banner">
        <h2>Session Paused</h2>
        <button type="button" class="btn-primary" onclick={() => controller?.resume()}>
          Resume session
        </button>
      </div>
    {:else if controller.phase === 'complete' && controller.summary}
      <SessionResult
        summary={controller.summary}
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
    {:else if controller.currentPrompt}
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
    min-height: var(--answer-target-min, 3rem);
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

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { getLessonChars, LESSONS } from '../../training/sequence';
  import { canCheck } from '../../training/session';
  import {
    createCopyAttempt,
    emptyCopyAttempt,
    copyPlaybackEvent,
    reviewCopyAttempt,
    copyInputLimit,
    boundCopyInput,
    type CopyAttempt
  } from '../../practice/copy-attempt';
  import { normalizePlaybackSettings } from '../../practice/playback';
  import { practiceKeyIntent } from '../../practice/keyboard';
  import { formatClock, percentage } from '../../format';
  import MorsePlayer from '../MorsePlayer.svelte';
  import ResultOverlay from '../ResultOverlay.svelte';
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    lesson?: number;
    charWpm?: number;
    effWpm?: number;
    freq?: number;
    volume?: number;
    startDelay?: number;
    onStart?: () => void;
    onReview?: (attempt: CopyAttempt) => void;
    persistenceStatus?: 'saving' | 'saved' | 'failed' | null;
    onRetrySave?: () => void;
  }

  let {
    lesson = 1,
    charWpm = 20,
    effWpm = 12,
    freq = 600,
    volume = 1.0,
    startDelay = 0.5,
    onStart,
    onReview,
    persistenceStatus = null,
    onRetrySave
  }: Props = $props();

  let settings = $state(normalizePlaybackSettings({}));
  let attempt = $state.raw(emptyCopyAttempt());
  let activeLesson = $derived(attempt.exercise.lesson);
  let session = $derived(attempt.session);
  let lessonText = $derived(attempt.exercise.text);

  let inputText = $state('');
  let result = $derived(attempt.review?.result.accuracy ?? -1);
  let showOverlay = $state(false);
  let diffTokens = $derived(attempt.review?.diffTokens ?? []);
  let newExerciseArmed = $state(false);
  let newExerciseTimer: ReturnType<typeof setTimeout> | null = null;
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let answerEl = $state<HTMLTextAreaElement | null>(null);

  let player = $state<{
    playNow: () => Promise<void>;
    stopNow: () => Promise<void>;
    isStarted: () => boolean;
  } | null>(null);
  let savePending = $derived(persistenceStatus === 'saving' || persistenceStatus === 'failed');

  $effect.pre(() => {
    const next = normalizePlaybackSettings({ charWpm, effWpm, freq, volume, startDelay });
    const nextLesson = lesson;
    untrack(() => {
      settings = next;
      regenerate(nextLesson);
    });
  });

  let currentLessonChars = $derived(getLessonChars(activeLesson).split('').filter(Boolean));
  let isLetter = (c: string) => /[A-Z]/.test(c);
  let isNumber = (c: string) => /[0-9]/.test(c);
  let numberChars = $derived(currentLessonChars.filter(isNumber));
  let symbolChars = $derived(currentLessonChars.filter((c) => !isLetter(c) && !isNumber(c)));
  let lessonKindLabel = $derived(
    numberChars.length + symbolChars.length > 0
      ? m.trainer_lesson_mixed()
      : m.trainer_lesson_letters()
  );

  let sendSeconds = $derived(Math.floor(attempt.duration));
  let transportLive = $derived(session.status === 'playing' || session.status === 'paused');
  let sessionStarted = $derived(session.status !== 'ready' && session.status !== 'disposed');
  let checkEnabled = $derived(canCheck(session) && inputText.trim() !== '');

  let flowSteps = $derived([
    { index: 0, label: m.trainer_flow_start },
    { index: 1, label: m.trainer_flow_listen },
    { index: 2, label: m.trainer_flow_type },
    { index: 3, label: m.trainer_flow_check },
    { index: 4, label: m.trainer_flow_review }
  ]);
  let flowIndex = $derived(
    session.status === 'ready'
      ? 0
      : transportLive
        ? 1
        : session.status === 'reviewed'
          ? 4
          : inputText.trim() === ''
            ? 2
            : 3
  );

  let sessionStateText = $derived(
    session.status === 'reviewed'
      ? m.trainer_state_checked()
      : transportLive
        ? m.trainer_state_listening()
        : session.status === 'ready'
          ? m.trainer_state_ready()
          : inputText.trim() !== ''
            ? m.trainer_state_ready_check()
            : m.trainer_state_idle()
  );

  let newExerciseLabel = $derived(
    newExerciseArmed ? m.trainer_new_exercise_confirm() : m.trainer_try_again()
  );

  function clearNewExerciseArm() {
    newExerciseArmed = false;
    if (newExerciseTimer) {
      clearTimeout(newExerciseTimer);
      newExerciseTimer = null;
    }
  }

  function regenerate(nextLesson = activeLesson) {
    if (savePending) return;
    clearNewExerciseArm();
    if (focusTimer) clearTimeout(focusTimer);
    void player?.stopNow();
    attempt = createCopyAttempt(nextLesson, settings, attempt);
    inputText = '';
    showOverlay = false;
  }

  function requestNewExercise() {
    const unfinished = result < 0 && (inputText.trim() !== '' || session.status !== 'ready');
    if (newExerciseTimer) clearTimeout(newExerciseTimer);

    if (!newExerciseArmed && !unfinished) {
      regenerate();
      return;
    }

    if (newExerciseArmed) {
      regenerate();
      return;
    }

    newExerciseArmed = true;
    newExerciseTimer = setTimeout(clearNewExerciseArm, 4000);
  }

  function handleStart() {
    onStart?.();
    attempt = copyPlaybackEvent(attempt, 'start');
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = null;
      if (!showOverlay && sessionStarted) answerEl?.focus();
    }, 100);
  }

  function handleEnded() {
    attempt = copyPlaybackEvent(attempt, 'stop');
  }

  function handleCheck() {
    if (!checkEnabled) return;
    void player?.stopNow();
    attempt = reviewCopyAttempt(attempt, inputText);
    onReview?.(attempt);
    showOverlay = true;
  }

  function handleNextLesson() {
    if (activeLesson < LESSONS.length) {
      regenerate(activeLesson + 1);
    }
  }

  function handlePrevLesson() {
    if (activeLesson > 1) {
      regenerate(activeLesson - 1);
    }
  }

  function onPracticeKeydown(event: KeyboardEvent) {
    if (showOverlay) return;
    const intent = practiceKeyIntent(event);
    if (intent === 'check' && sessionStarted) {
      event.preventDefault();
      if (checkEnabled) handleCheck();
    } else if (intent === 'stop' && transportLive) {
      event.preventDefault();
      void player?.stopNow();
    } else if (intent === 'replay') {
      event.preventDefault();
      void player?.playNow();
    }
  }

  onDestroy(() => {
    if (newExerciseTimer) clearTimeout(newExerciseTimer);
    if (focusTimer) clearTimeout(focusTimer);
  });
</script>

<svelte:window onkeydown={onPracticeKeydown} />

<div class="continuous-copy-practice" role="region" aria-label={m.practice_copy_region()}>
  <div class="console-head">
    <div class="lesson-nav-row">
      <div class="lesson-picker" role="group" aria-label={m.trainer_current_lesson()}>
        <button
          type="button"
          class="btn-icon"
          onclick={handlePrevLesson}
          disabled={savePending || activeLesson <= 1}
          aria-label={m.trainer_lesson_prev()}
          title={m.trainer_lesson_prev()}
        >
          <ChevronLeft size={16} />
        </button>
        <span class="lesson-label">{m.trainer_label_lesson()} {activeLesson}</span>
        <button
          type="button"
          class="btn-icon"
          onclick={handleNextLesson}
          disabled={savePending || activeLesson >= LESSONS.length}
          aria-label={m.trainer_lesson_next()}
          title={m.trainer_lesson_next()}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <p class="console-title">
        {m.trainer_lesson_summary({
          lesson: String(activeLesson),
          kind: lessonKindLabel
        })}
      </p>
    </div>

    <p class="console-meta">
      {m.trainer_summary_meta({
        count: String(currentLessonChars.length),
        speed: `${settings.charWpm}/${settings.effWpm}`,
        hz: String(settings.freq),
        time: formatClock(sendSeconds)
      })}
    </p>
  </div>

  <ol class="flow" aria-label={m.trainer_flow_legend()}>
    {#each flowSteps as step, index (step.index)}
      <li
        class="flow-step"
        class:is-current={index === flowIndex}
        class:is-done={index < flowIndex}
        aria-current={index === flowIndex ? 'step' : undefined}
      >
        <span class="sr-only">{m.trainer_flow_step({ step: String(index + 1) })}:</span>
        <span class="flow-dot" aria-hidden="true"></span>
        <span>{step.label()}</span>
      </li>
    {/each}
  </ol>

  <div class="player-wrapper">
    <MorsePlayer
      bind:this={player}
      text={lessonText}
      bind:charWpm={settings.charWpm}
      bind:effWpm={settings.effWpm}
      bind:freq={settings.freq}
      bind:volume={settings.volume}
      bind:startDelay={settings.startDelay}
      onSettingsInput={() => regenerate()}
      showSettings
      playTone={sessionStarted && !transportLive ? 'quiet' : 'primary'}
      showTransportExtras={transportLive}
      onStart={handleStart}
      onEnded={handleEnded}
      playLabel={sessionStarted ? m.trainer_replay() : m.player_play()}
      label={m.player_label()}
    />
  </div>

  <div class="answer-section">
    <label class="field">
      <span class="label-text">{m.trainer_answer_label()}</span>
      <textarea
        bind:this={answerEl}
        bind:value={() => inputText, (value) => (inputText = boundCopyInput(lessonText, value))}
        class="textarea copy-textarea"
        placeholder={m.trainer_answer_placeholder()}
        disabled={!sessionStarted}
        maxlength={copyInputLimit(lessonText)}
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"></textarea>
    </label>

    <p class="session-state" aria-live="polite">{sessionStateText}</p>

    {#if !showOverlay && result >= 0}
      <p class="result-line" aria-live="polite">
        {m.trainer_result_last({ percent: percentage(result) })}
        <button type="button" class="quiet-btn" onclick={() => (showOverlay = true)}>
          {m.trainer_result_review()}
        </button>
      </p>
    {/if}

    <p class="key-hints">
      {#if !sessionStarted}
        <span class="key-hint"><kbd>Space</kbd> {m.trainer_hint_start()}</span>
      {:else if !transportLive}
        <span class="key-hint"><kbd>Space</kbd> {m.trainer_hint_play()}</span>
      {/if}
      <span class="key-hint"><kbd>Enter</kbd> {m.trainer_hint_check()}</span>
      <span class="key-hint"><kbd>Esc</kbd> {m.trainer_hint_stop()}</span>
    </p>

    <div class="action-row">
      <button type="button" class="btn-primary" onclick={handleCheck} disabled={!checkEnabled}>
        {m.trainer_check()}
      </button>

      <button
        type="button"
        class="btn-ghost"
        class:is-armed={newExerciseArmed}
        onclick={requestNewExercise}
        disabled={savePending}
      >
        {newExerciseLabel}
      </button>
    </div>
  </div>

  {#if showOverlay}
    <ResultOverlay
      {result}
      {diffTokens}
      lessonNum={activeLesson}
      sourceText={lessonText}
      hasNextLesson={activeLesson < LESSONS.length}
      hasPrevLesson={activeLesson > 1}
      nextLessonNum={activeLesson + 1}
      prevLessonNum={activeLesson - 1}
      onClose={() => (showOverlay = false)}
      onNext={handleNextLesson}
      onPrev={handlePrevLesson}
      onRegenerate={() => regenerate()}
      {persistenceStatus}
      {onRetrySave}
    />
  {/if}
</div>

<style>
  .continuous-copy-practice {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow);
  }

  .console-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .lesson-nav-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .lesson-picker {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .lesson-picker button,
  .action-row button {
    min-width: var(--answer-target-min);
    min-height: var(--answer-target-min);
  }

  .lesson-label {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .console-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .console-meta {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .flow {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .flow-step {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .flow-step.is-done {
    color: var(--text-secondary);
  }

  .flow-step.is-current {
    color: var(--accent);
    font-weight: 600;
  }

  .flow-dot {
    width: 6px;
    height: 6px;
    border: 1px solid var(--border-control);
    border-radius: 50%;
  }

  .flow-step.is-done .flow-dot {
    background: var(--text-muted);
    border-color: var(--text-muted);
  }

  .flow-step.is-current .flow-dot {
    background: var(--accent);
    border-color: var(--accent);
  }

  .player-wrapper {
    display: flex;
    justify-content: center;
    padding: var(--space-2) 0;
  }

  .answer-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .copy-textarea {
    width: 100%;
    min-height: 8rem;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    text-transform: uppercase;
  }

  .session-state {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .result-line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .quiet-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font-size: var(--text-xs);
  }

  .key-hints {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
  }

  .key-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .key-hint kbd {
    font-family: var(--font-mono);
    padding: 0.05rem 0.3rem;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
  }

  .action-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .btn-ghost.is-armed {
    border-color: var(--status-bad);
    color: var(--status-bad);
  }
</style>

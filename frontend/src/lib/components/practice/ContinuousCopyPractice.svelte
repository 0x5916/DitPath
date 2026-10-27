<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
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
  import { percentage } from '../../format';
  import MorsePlayer from '../MorsePlayer.svelte';
  import ResultOverlay from '../ResultOverlay.svelte';
  import ExitSessionDialog from '../learning/ExitSessionDialog.svelte';
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
    onFinish?: () => void;
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
    onFinish,
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
  let playbackPaused = $state(false);
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let answerEl = $state<HTMLTextAreaElement | null>(null);
  let discardOpen = $state(false);
  let discardReturnFocus = $state<HTMLElement | null>(null);
  let resolveDiscard: ((confirmed: boolean) => void) | null = null;
  let destroyed = false;

  let player = $state<{
    playNow: () => Promise<void>;
    stopNow: () => Promise<void>;
    isStarted: () => boolean;
    focusPlay: () => void;
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

  let transportLive = $derived(session.status === 'playing' || session.status === 'paused');
  let sessionStarted = $derived(session.status !== 'ready' && session.status !== 'disposed');
  let checkEnabled = $derived(canCheck(session) && inputText.trim() !== '');
  let unfinished = $derived(result < 0 && (inputText.trim() !== '' || session.status !== 'ready'));

  let sessionStateText = $derived(
    session.status === 'reviewed'
      ? m.trainer_state_checked()
      : playbackPaused
        ? m.practice_paused()
        : transportLive
          ? m.trainer_state_listening()
          : session.status === 'ready'
            ? m.trainer_state_ready()
            : inputText.trim() !== ''
              ? m.trainer_state_ready_check()
              : m.trainer_state_idle()
  );

  function regenerate(nextLesson = activeLesson) {
    if (savePending) return;
    if (focusTimer) clearTimeout(focusTimer);
    void player?.stopNow();
    attempt = createCopyAttempt(nextLesson, settings, attempt);
    inputText = '';
    showOverlay = false;
  }

  async function confirmReplaceExercise(): Promise<boolean> {
    if (destroyed || savePending || resolveDiscard) return false;
    if (!unfinished) return true;
    const exercise = attempt.exercise;
    discardReturnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void player?.stopNow();
    discardOpen = true;
    const confirmed = await new Promise<boolean>((resolve) => (resolveDiscard = resolve));
    return confirmed && !destroyed && !savePending && attempt.exercise === exercise;
  }

  function finishDiscardDecision(confirmed: boolean) {
    const resolve = resolveDiscard;
    resolveDiscard = null;
    discardOpen = false;
    resolve?.(confirmed);
  }

  async function requestNewExercise() {
    if (await confirmReplaceExercise()) await startNewExercise();
  }

  async function startNewExercise() {
    if (savePending) return;
    regenerate();
    await tick();
    if (!destroyed) player?.focusPlay();
  }

  async function selectLesson(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const nextLesson = Number(select.value);
    select.value = String(activeLesson);
    if (nextLesson !== activeLesson && (await confirmReplaceExercise())) regenerate(nextLesson);
  }

  export function focusCopy() {
    answerEl?.focus();
  }
  export function hasUnfinishedCopy() {
    return unfinished;
  }
  export function prepareToLeave() {
    void player?.stopNow();
    showOverlay = false;
    finishDiscardDecision(false);
  }
  async function finishPractice() {
    prepareToLeave();
    await tick();
    onFinish?.();
  }

  function handleStart() {
    onStart?.();
    attempt = copyPlaybackEvent(attempt, 'start');
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = null;
      if (!showOverlay && !discardOpen && sessionStarted) answerEl?.focus();
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

  function onPracticeKeydown(event: KeyboardEvent) {
    if (showOverlay || discardOpen) return;
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
    destroyed = true;
    finishDiscardDecision(false);
    if (focusTimer) clearTimeout(focusTimer);
  });
</script>

<svelte:window onkeydown={onPracticeKeydown} />

<div class="continuous-copy-practice" role="region" aria-label={m.practice_copy_region()}>
  <div class="console-head">
    <label class="field">
      <span class="label-text">{m.trainer_current_lesson()}</span>
      <select class="select" value={activeLesson} onchange={selectLesson} disabled={savePending}>
        {#each LESSONS as characters, index (index)}
          <option value={index + 1}
            >{m.home_lesson_title({
              step: index + 1,
              characters: characters.split('').join(', ')
            })}</option
          >
        {/each}
      </select>
    </label>
    <p class="console-meta">
      {m.practice_speed_summary({ character: settings.charWpm, effective: settings.effWpm })}
    </p>
    <details class="character-details">
      <summary>{m.practice_character_count({ count: currentLessonChars.length })}</summary>
      <p>{currentLessonChars.join(' ')}</p>
    </details>
  </div>

  <p class="session-state" aria-live="polite">{sessionStateText}</p>
  <div class="player-wrapper">
    <MorsePlayer
      exposureSource="group"
      bind:this={player}
      text={lessonText}
      bind:charWpm={settings.charWpm}
      bind:effWpm={settings.effWpm}
      bind:freq={settings.freq}
      bind:volume={settings.volume}
      bind:startDelay={settings.startDelay}
      onBeforeSettingsInput={confirmReplaceExercise}
      onSettingsInput={() => regenerate()}
      showSettings
      playTone={sessionStarted ? 'quiet' : 'primary'}
      showTransportExtras={transportLive}
      onStart={handleStart}
      onEnded={handleEnded}
      playLabel={sessionStarted ? m.trainer_replay() : m.practice_start()}
      onPausedChange={(paused) => (playbackPaused = paused)}
    />
  </div>

  <div class="answer-section">
    {#if sessionStarted}
      <label class="field">
        <span class="label-text">{m.trainer_answer_label()}</span>
        <textarea
          bind:this={answerEl}
          bind:value={() => inputText, (value) => (inputText = boundCopyInput(lessonText, value))}
          class="textarea copy-textarea"
          placeholder={m.trainer_answer_placeholder()}
          readonly={result >= 0}
          maxlength={copyInputLimit(lessonText)}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"></textarea>
      </label>
    {/if}

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
      {#if sessionStarted && result < 0}<span class="key-hint"
          ><kbd>Enter</kbd> {m.trainer_hint_check()}</span
        >{/if}
      {#if transportLive}<span class="key-hint"><kbd>Esc</kbd> {m.trainer_hint_stop()}</span>{/if}
    </p>

    <div class="action-row">
      {#if sessionStarted && result < 0}
        <button type="button" class="btn-primary" onclick={handleCheck} disabled={!checkEnabled}
          >{m.trainer_check()}</button
        >
      {/if}
      {#if sessionStarted}
        <button type="button" class="btn-ghost" onclick={requestNewExercise} disabled={savePending}
          >{m.trainer_try_again()}</button
        >
      {/if}
      {#if persistenceStatus === 'failed'}<button
          type="button"
          class="btn-ghost"
          onclick={() => (showOverlay = true)}>{m.lesson_retry_save()}</button
        >{/if}
    </div>
  </div>

  {#if showOverlay}
    <ResultOverlay
      {result}
      {diffTokens}
      lessonNum={activeLesson}
      sourceText={lessonText}
      onClose={() => (showOverlay = false)}
      onFinish={() => void finishPractice()}
      onRegenerate={() => void startNewExercise()}
      {persistenceStatus}
      {onRetrySave}
    />
  {/if}
</div>

<ExitSessionDialog
  isOpen={discardOpen}
  title={m.practice_replace_title()}
  description={m.trainer_discard_description()}
  confirmLabel={m.trainer_discard_action()}
  cancelLabel={m.practice_keep_copy()}
  returnFocusTo={discardReturnFocus}
  fallbackFocus={answerEl}
  onConfirm={() => finishDiscardDecision(true)}
  onCancel={() => finishDiscardDecision(false)}
/>

<style>
  .continuous-copy-practice {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }
  .console-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-4);
    align-items: center;
  }
  .console-head .field {
    grid-column: 1 / -1;
  }
  .console-meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .character-details {
    font-size: var(--text-sm);
  }
  .character-details summary {
    cursor: pointer;
    min-height: var(--answer-target-min);
    padding-block: var(--space-3);
  }
  .character-details p {
    max-width: 24rem;
    overflow-wrap: anywhere;
    font-family: var(--font-mono);
    margin: 0 0 var(--space-2);
  }
  .session-state {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-secondary);
  }
  .player-wrapper {
    display: flex;
    justify-content: flex-start;
  }
  .answer-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .copy-textarea {
    width: 100%;
    min-height: 9rem;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    text-transform: uppercase;
  }
  .result-line {
    margin: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .quiet-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    min-height: var(--answer-target-min);
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
    gap: var(--space-1);
  }
  .key-hint kbd {
    font-family: var(--font-mono);
  }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .action-row button {
    min-height: var(--answer-target-min);
  }
  @media (max-width: 480px) {
    .action-row {
      flex-direction: column;
    }
  }
</style>

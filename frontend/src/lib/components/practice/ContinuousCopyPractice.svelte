<script lang="ts">
  import { browser } from '$app/environment';
  import { calculateDuration, getLessonChars, LESSONS, createExercise } from '../../morse';
  import type { Exercise } from '../../training/exercise';
  import { canCheck, createSession, transition, type SessionState } from '../../training/session';
  import { score, diffWords, type DiffToken } from '../../score';
  import { formatClock, percentage } from '../../format';
  import MorsePlayer from '../MorsePlayer.svelte';
  import ResultOverlay from '../ResultOverlay.svelte';
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    lesson?: number;
    charWpm?: number;
    effWpm?: number;
    freq?: number;
    volume?: number;
    startDelay?: number;
  }

  let {
    lesson = 1,
    charWpm = 20,
    effWpm = 12,
    freq = 600,
    volume = 1.0,
    startDelay = 0.5
  }: Props = $props();

  let activeLesson = $state(1);
  let session = $state<SessionState>(createSession());
  let exercise = $state<Exercise>({ lesson: 1, text: '' });
  let lessonText = $derived(exercise.text);

  let inputText = $state('');
  let result = $state(-1);
  let showOverlay = $state(false);
  let diffTokens = $state<DiffToken[]>([]);
  let newExerciseArmed = $state(false);
  let newExerciseTimer: ReturnType<typeof setTimeout> | null = null;
  let answerEl = $state<HTMLTextAreaElement | null>(null);

  let player = $state<{
    playNow: () => Promise<void>;
    stopNow: () => Promise<void>;
    isStarted: () => boolean;
  } | null>(null);

  $effect.pre(() => {
    activeLesson = lesson;
    exercise = createExercise({ lesson, charWpm, effWpm });
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

  let sendSeconds = $derived(Math.floor(calculateDuration(lessonText, charWpm, effWpm)));
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

  function regenerate() {
    clearNewExerciseArm();
    exercise = createExercise({ lesson: activeLesson, charWpm, effWpm });
    const res = transition(session, { type: 'new-exercise' });
    if (res.ok) session = res.state;
    inputText = '';
    result = -1;
    diffTokens = [];
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
    newExerciseTimer = setTimeout(() => (newExerciseArmed = false), 4000);
  }

  function handleStart() {
    const res = transition(session, { type: 'start' });
    if (res.ok) session = res.state;
    if (browser) setTimeout(() => answerEl?.focus(), 100);
  }

  function handleEnded() {
    const res = transition(session, { type: 'stop' });
    if (res.ok) session = res.state;
  }

  function handleCheck() {
    if (!checkEnabled) return;
    const accuracy = score(lessonText, inputText);
    result = accuracy;
    diffTokens = diffWords(lessonText, inputText);
    showOverlay = true;

    const res = transition(session, {
      type: 'check',
      result: {
        lesson: activeLesson,
        charWpm,
        effWpm,
        accuracy,
        completedAt: new Date().toISOString()
      }
    });
    if (res.ok) session = res.state;
  }

  function handleNextLesson() {
    if (activeLesson < LESSONS.length) {
      activeLesson += 1;
      regenerate();
    }
  }

  function handlePrevLesson() {
    if (activeLesson > 1) {
      activeLesson -= 1;
      regenerate();
    }
  }

  function onAnswerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (checkEnabled) handleCheck();
    } else if (event.key === 'Escape' && transportLive) {
      event.preventDefault();
      void player?.stopNow();
    }
  }
</script>

<div class="continuous-copy-practice" role="region" aria-label="Continuous copy practice">
  <div class="console-head">
    <div class="lesson-nav-row">
      <div class="lesson-picker" role="group" aria-label={m.trainer_current_lesson()}>
        <button
          type="button"
          class="btn-icon"
          onclick={handlePrevLesson}
          disabled={activeLesson <= 1}
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
          disabled={activeLesson >= LESSONS.length}
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
        speed: `${charWpm}/${effWpm}`,
        hz: String(freq),
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
      {charWpm}
      {effWpm}
      {freq}
      {volume}
      {startDelay}
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
        bind:value={inputText}
        class="textarea copy-textarea"
        placeholder={m.trainer_answer_placeholder()}
        disabled={!sessionStarted}
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onAnswerKeydown}></textarea>
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
      onRegenerate={regenerate}
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
    max-width: var(--max-width-narrow, 46rem);
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

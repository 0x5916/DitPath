<script lang="ts">
  import { X, Check, Minus, Plus, CircleAlert } from '@lucide/svelte';
  import { dialogFocusables, dialogFocusTarget } from './dialog-focus';
  import { scoreGrade, type DiffToken } from '#lib/score.ts';
  import { percentage } from '#lib/format.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { onMount } from 'svelte';

  interface Props {
    result: number;
    diffTokens: DiffToken[];
    /** Lesson the result belongs to (shown in the panel header area). */
    lessonNum: number;
    /** The passage that was sent — the reference for the diff and the copy. */
    sourceText: string;
    hasNextLesson: boolean;
    hasPrevLesson: boolean;
    nextLessonNum: number;
    prevLessonNum: number;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    onRegenerate: () => void;
    persistenceStatus?: 'saving' | 'saved' | 'failed' | null;
    onRetrySave?: () => void;
  }

  let {
    result,
    diffTokens,
    lessonNum,
    sourceText,
    hasNextLesson,
    hasPrevLesson,
    nextLessonNum,
    prevLessonNum,
    onClose,
    onNext,
    onPrev,
    onRegenerate,
    persistenceStatus = null,
    onRetrySave
  }: Props = $props();

  let grade = $derived(scoreGrade(result));
  let scoreText = $derived(
    grade === 'good'
      ? m.practice_score_great()
      : grade === 'ok'
        ? m.trainer_score_good()
        : m.trainer_score_bad()
  );
  let pct = $derived(percentage(result));
  let savePending = $derived(persistenceStatus === 'saving' || persistenceStatus === 'failed');

  let panelRef = $state<HTMLDivElement | null>(null);
  let restoreFocusTo: HTMLElement | null = null;
  const titleId = $props.id();

  /**
   * Keep Tab inside the panel and close on Escape, returning focus to whatever
   * opened it. Native Space/Enter activation stays on the focused control.
   */
  function onPanelKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (
      event.key === 'Escape' &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef) return;
    const target = dialogFocusTarget(
      dialogFocusables(panelRef),
      document.activeElement as HTMLElement | null,
      event.shiftKey,
      panelRef
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  onMount(() => {
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the panel itself: it is labelled by the dialog title, so screen
    // readers announce the dialog name before the learner moves on.
    panelRef?.focus();
    function containFocus(event: FocusEvent) {
      if (panelRef && event.target instanceof Node && !panelRef.contains(event.target))
        panelRef.focus();
    }
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('focusin', containFocus);
      if (restoreFocusTo?.isConnected) restoreFocusTo.focus({ preventScroll: true });
    };
  });
</script>

<div class="overlay-backdrop" onclick={handleBackdropClick} role="presentation">
  <div
    class="overlay-panel"
    bind:this={panelRef}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    onkeydown={onPanelKeydown}
  >
    <header class="overlay-head">
      <h2 id={titleId} class="overlay-title">{m.trainer_result_title()}</h2>
      <button
        class="overlay-close btn-icon"
        type="button"
        onclick={onClose}
        aria-label={m.overlay_close()}
      >
        <X size={16} />
      </button>
    </header>

    <div class="overlay-score overlay-{grade}">
      <p class="overlay-pct">{pct}</p>
      <div class="overlay-score-body">
        <p class="overlay-grade">{scoreText}</p>
        <p class="overlay-rule">{m.practice_result_lesson({ lesson: String(lessonNum) })}</p>
      </div>
    </div>

    <section class="overlay-source">
      <p class="panel-label">{m.trainer_source_label()}</p>
      <p class="quote-text">{sourceText}</p>
    </section>

    <section class="overlay-diff-section">
      <div class="overlay-diff-header">
        <h3 class="card-title">{m.trainer_diff_title()}</h3>
      </div>
      <div class="diff-tokens overlay-diff-tokens">
        {#each diffTokens as tok, i (i)}
          {#if tok.type === 'correct'}
            <span
              class="diff-token diff-correct"
              role="img"
              aria-label={m.practice_diff_correct({ text: tok.ref })}
            >
              <Check size={12} aria-hidden="true" />{tok.ref}
            </span>
          {:else if tok.type === 'substitution'}
            <span
              class="diff-token diff-sub"
              role="img"
              title={m.overlay_diff_expected({ char: tok.ref })}
              aria-label={m.practice_diff_substitution({ entered: tok.inp, expected: tok.ref })}
              ><X size={12} aria-hidden="true" />{tok.inp}<span class="diff-expected">
                ({tok.ref})</span
              ></span
            >
          {:else if tok.type === 'missing'}
            <span
              class="diff-token diff-missing"
              role="img"
              title={m.overlay_diff_expected({ char: tok.ref })}
              aria-label={m.practice_diff_missing({ text: tok.ref })}
              ><Minus size={12} aria-hidden="true" />{tok.ref}</span
            >
          {:else if tok.type === 'extra'}
            <span
              class="diff-token diff-extra"
              role="img"
              aria-label={m.practice_diff_extra({ text: tok.inp })}
            >
              <Plus size={12} aria-hidden="true" />{tok.inp}
            </span>
          {/if}
        {/each}
      </div>
      <div class="diff-legend">
        <span class="diff-token diff-correct"
          ><Check size={12} aria-hidden="true" />{m.trainer_diff_legend_correct()}</span
        >
        <span class="diff-token diff-sub"
          ><X size={12} aria-hidden="true" />{m.trainer_diff_legend_sub()}</span
        >
        <span class="diff-token diff-missing"
          ><Minus size={12} aria-hidden="true" />{m.trainer_diff_legend_missing()}</span
        >
        <span class="diff-token diff-extra"
          ><Plus size={12} aria-hidden="true" />{m.trainer_diff_legend_extra()}</span
        >
      </div>
    </section>

    {#if persistenceStatus}
      <div class="overlay-source" role={persistenceStatus === 'failed' ? 'alert' : 'status'}>
        {#if persistenceStatus === 'failed'}
          <CircleAlert size={16} aria-hidden="true" />
          <p>{m.practice_history_failed()}</p>
          <button type="button" class="btn-primary" onclick={onRetrySave}
            >{m.lesson_retry_save()}</button
          >
        {:else if persistenceStatus === 'saved'}
          <Check size={16} aria-hidden="true" />
          <p>{m.practice_history_saved()}</p>
        {:else}
          <p>{m.practice_history_saving()}</p>
        {/if}
      </div>
    {/if}

    <footer class="overlay-actions">
      {#if hasNextLesson}
        <button type="button" class="btn-primary" onclick={onNext} disabled={savePending}>
          {m.trainer_next_lesson({ lesson: String(nextLessonNum) })}
        </button>
      {/if}
      <button type="button" class="btn-ghost" onclick={onRegenerate} disabled={savePending}
        >{m.trainer_try_again()}</button
      >
      {#if hasPrevLesson}
        <button type="button" class="btn-ghost" onclick={onPrev} disabled={savePending}>
          {m.trainer_prev_lesson({ lesson: String(prevLessonNum) })}
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  /* A compact panel, not a takeover: the practice surface stays visible around
     it and the scrim is flat (no blur, no glow). */
  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg-base) 70%, transparent);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .overlay-panel {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 32rem;
    max-height: 85vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay);
  }

  .overlay-panel:focus {
    outline: none;
  }

  .overlay-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .overlay-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  /* Score strip: a readout, not a hero. */
  .overlay-score {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
  }

  .overlay-good {
    background: var(--result-good-bg);
  }

  .overlay-ok {
    background: var(--status-ok-tint);
  }

  .overlay-bad {
    background: var(--result-bad-bg);
  }

  .overlay-pct {
    margin: 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 2.25rem;
    font-weight: 500;
    line-height: 1;
  }

  .overlay-good .overlay-pct {
    color: var(--status-good);
  }

  .overlay-ok .overlay-pct {
    color: var(--status-ok);
  }

  .overlay-bad .overlay-pct {
    color: var(--status-bad);
  }

  .overlay-score-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .overlay-grade {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .overlay-rule {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  /* Reference transcript: the source the copy is compared against. */
  .overlay-source {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--border);
  }

  .overlay-diff-section {
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .overlay-diff-header :global(.card-title) {
    margin: 0;
  }

  .overlay-diff-tokens {
    max-height: 34vh;
    overflow-y: auto;
  }

  .overlay-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5) var(--space-5);
    border-top: 1px solid var(--border);
  }

  .diff-token {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .overlay-actions button,
  .overlay-close {
    min-width: var(--answer-target-min, 3rem);
    min-height: var(--answer-target-min, 3rem);
  }

  @media (max-width: 640px) {
    .overlay-actions > * {
      flex: 1 1 auto;
    }
  }
</style>

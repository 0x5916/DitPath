<script lang="ts">
  import { X } from '@lucide/svelte';
  import { scoreGrade, type DiffToken } from '$lib/score';
  import { percentage } from '$lib/format';
  import * as m from '$lib/paraglide/messages';
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
    onRegenerate
  }: Props = $props();

  let grade = $derived(scoreGrade(result));
  let scoreText = $derived(
    grade === 'good'
      ? m.trainer_score_great()
      : grade === 'ok'
        ? m.trainer_score_good()
        : m.trainer_score_bad()
  );
  let pct = $derived(percentage(result));

  let panelRef = $state<HTMLDivElement | null>(null);
  let restoreFocusTo: HTMLElement | null = null;

  function focusable(): HTMLElement[] {
    if (!panelRef) return [];
    return Array.from(
      panelRef.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled'));
  }

  /**
   * Keep Tab inside the panel and close on Escape, returning focus to whatever
   * opened it. The background stays inert to keyboard users without `inert`
   * support games: nothing else is reachable while the loop below is active.
   */
  function onPanelKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
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
    return () => restoreFocusTo?.focus();
  });
</script>

<div class="overlay-backdrop" onclick={handleBackdropClick} role="presentation">
  <div
    class="overlay-panel"
    bind:this={panelRef}
    role="dialog"
    aria-modal="true"
    aria-labelledby="overlay-title"
    tabindex="-1"
    onkeydown={onPanelKeydown}
  >
    <header class="overlay-head">
      <h2 id="overlay-title" class="overlay-title">{m.trainer_result_title()}</h2>
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
        <p class="overlay-rule">{m.trainer_result_lesson({ lesson: String(lessonNum) })}</p>
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
            <span class="diff-token diff-correct">{tok.ref}</span>
          {:else if tok.type === 'substitution'}
            <span class="diff-token diff-sub" title={m.overlay_diff_expected({ char: tok.ref })}
              >{tok.inp}<span class="diff-expected"> ({tok.ref})</span></span
            >
          {:else if tok.type === 'missing'}
            <span class="diff-token diff-missing" title={m.overlay_diff_expected({ char: tok.ref })}
              >{tok.ref}</span
            >
          {:else if tok.type === 'extra'}
            <span class="diff-token diff-extra">{tok.inp}</span>
          {/if}
        {/each}
      </div>
      <div class="diff-legend">
        <span class="diff-token diff-correct">{m.trainer_diff_legend_correct()}</span>
        <span class="diff-token diff-sub">{m.trainer_diff_legend_sub()}</span>
        <span class="diff-token diff-missing">{m.trainer_diff_legend_missing()}</span>
        <span class="diff-token diff-extra">{m.trainer_diff_legend_extra()}</span>
      </div>
    </section>

    <footer class="overlay-actions">
      {#if hasNextLesson}
        <button type="button" class="btn-primary" onclick={onNext}>
          {m.trainer_next_lesson({ lesson: String(nextLessonNum) })}
        </button>
      {/if}
      <button type="button" class="btn-ghost" onclick={onRegenerate}>{m.trainer_try_again()}</button
      >
      {#if hasPrevLesson}
        <button type="button" class="btn-ghost" onclick={onPrev}>
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

  @media (max-width: 640px) {
    .overlay-actions > * {
      flex: 1 1 auto;
    }
  }
</style>

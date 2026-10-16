<script lang="ts">
  import { Check, X, AlertCircle, Volume2 } from '@lucide/svelte';
  import type { AttemptClassification } from '../../training/v2/types';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    classification: AttemptClassification;
    isCorrect: boolean;
    expected: string;
    entered?: string;
    playingCharacter?: string | null;
    onContinue: () => void;
    onPlayExpected?: () => void;
    onCompare?: () => void;
  }

  let {
    classification,
    isCorrect,
    expected,
    entered = '',
    playingCharacter = null,
    onContinue = () => {},
    onPlayExpected = () => {},
    onCompare = () => {}
  }: Props = $props();

  let canCompare = $derived(
    !isCorrect &&
      entered !== '' &&
      entered !== expected &&
      entered.length === 1 &&
      expected.length === 1
  );
</script>

<div
  class="feedback-card"
  aria-live="polite"
  aria-atomic="true"
  class:is-correct={isCorrect}
  class:is-incorrect={!isCorrect}
>
  <div class="feedback-header">
    {#if isCorrect && classification === 'unmeasured'}
      <div class="feedback-badge badge-good">
        <Check size={20} />
        <span>{m.lesson_correct()}</span>
      </div>
      <div class="feedback-subtext">{m.lesson_warmup_feedback()}</div>
    {:else if classification === 'automatic'}
      <div class="feedback-badge badge-good">
        <Check size={20} />
        <span>{m.lesson_correct()}</span>
      </div>
      <div class="feedback-subtext">{m.lesson_feedback_automatic()}</div>
    {:else if classification === 'developing'}
      <div class="feedback-badge badge-good">
        <Check size={20} />
        <span>{m.lesson_correct()}</span>
      </div>
      <div class="feedback-subtext">{m.lesson_feedback_developing()}</div>
    {:else if classification === 'incorrect'}
      <div class="feedback-badge badge-bad">
        <X size={20} />
        <span>{m.lesson_feedback_incorrect()}</span>
      </div>
    {:else if classification === 'missing'}
      <div class="feedback-badge badge-bad">
        <AlertCircle size={20} />
        <span>{m.lesson_feedback_missing()}</span>
      </div>
    {/if}
  </div>

  <div class="feedback-comparison">
    {#if !isCorrect && entered}
      <div class="comparison-row">
        <span class="comparison-label">{m.lesson_feedback_entered()}</span>
        <span class="comparison-val val-entered">{entered}</span>
      </div>
    {/if}
    <div class="comparison-row">
      <span class="comparison-label">{m.lesson_feedback_expected()}</span>
      <span class="comparison-val val-expected">{expected}</span>
    </div>
  </div>

  <div class="feedback-actions">
    {#if !isCorrect}
      <button
        type="button"
        class="btn-ghost"
        onclick={onPlayExpected}
        aria-busy={playingCharacter === expected}
      >
        <Volume2 size={18} />
        <span
          >{playingCharacter === expected
            ? m.lesson_playing_character({ character: expected })
            : m.lesson_hear_character({ character: expected })}</span
        >
      </button>

      {#if canCompare}
        <button type="button" class="btn-ghost" onclick={onCompare}>
          <span>{m.lesson_compare_characters({ first: entered, second: expected })}</span>
        </button>
      {/if}
    {/if}

    <button type="button" class="btn-primary" aria-keyshortcuts="Enter" onclick={onContinue}>
      {m.lesson_continue()} <kbd aria-hidden="true">{m.keyboard_enter()}</kbd>
    </button>
  </div>
</div>

<style>
  .feedback-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 26rem;
    box-shadow: var(--shadow-overlay);
  }

  .is-correct {
    border-top: 3px solid var(--learning-stable, var(--status-good));
  }

  .is-incorrect {
    border-top: 3px solid var(--learning-error, var(--status-bad));
  }

  .feedback-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
  }

  .feedback-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .badge-good {
    color: var(--learning-stable, var(--status-good));
  }

  .badge-bad {
    color: var(--learning-error, var(--status-bad));
  }

  .feedback-subtext {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .feedback-comparison {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    max-width: 18rem;
    padding: var(--space-3) 0;
  }

  .comparison-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-sm);
  }

  .comparison-label {
    color: var(--text-muted);
  }

  .comparison-val {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .val-entered {
    color: var(--learning-error, var(--status-bad));
  }

  .val-expected {
    color: var(--learning-stable, var(--status-good));
  }

  .feedback-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
    width: 100%;
  }

  .feedback-actions button {
    min-height: var(--answer-target-min, 3rem);
  }
</style>

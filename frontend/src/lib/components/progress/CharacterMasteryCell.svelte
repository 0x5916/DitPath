<script lang="ts">
  import type { CharacterMastery, MasteryStatus } from '../../training/v2/types';
  import { CheckCircle2, CircleDot, AlertCircle, Circle } from '@lucide/svelte';

  interface Props {
    character: string;
    mastery?: CharacterMastery | null;
    onclick?: () => void;
  }

  let { character, mastery = null, onclick = () => {} }: Props = $props();

  let status = $derived.by<MasteryStatus>(() => {
    return mastery?.status ?? 'new';
  });

  let accuracyLabel = $derived.by(() => {
    if (!mastery || mastery.totalAttempts === 0) return 'Untested';
    return `${Math.round(mastery.rollingAccuracy * 100)}% accuracy`;
  });

  let accessibleLabel = $derived(
    `${character}, ${status}, ${accuracyLabel}, ${mastery?.totalAttempts ?? 0} attempts`
  );
</script>

<button
  type="button"
  class="mastery-cell status-{status}"
  {onclick}
  aria-label={accessibleLabel}
  title={accessibleLabel}
>
  <span class="cell-char">{character}</span>
  <span class="cell-status-icon">
    {#if status === 'stable'}
      <CheckCircle2 size={12} />
    {:else if status === 'learning'}
      <CircleDot size={12} />
    {:else if status === 'review'}
      <AlertCircle size={12} />
    {:else}
      <Circle size={10} />
    {/if}
  </span>
</button>

<style>
  .mastery-cell {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    min-width: var(--answer-target-min, 3rem);
    min-height: var(--answer-target-min, 3rem);
    width: 3.25rem;
    height: 3.25rem;
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    position: relative;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .mastery-cell:hover {
    background-color: var(--bg-inset);
    border-color: var(--accent);
  }

  .cell-char {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
  }

  .cell-status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .status-stable .cell-status-icon {
    color: var(--learning-stable, var(--status-good));
  }

  .status-learning .cell-status-icon {
    color: var(--learning-current, var(--accent));
  }

  .status-review .cell-status-icon {
    color: var(--learning-review, var(--status-ok));
  }

  .status-new .cell-status-icon {
    color: var(--text-muted);
  }

  .status-stable {
    border-color: color-mix(in srgb, var(--status-good) 30%, var(--border));
  }

  .status-review {
    border-color: color-mix(in srgb, var(--status-ok) 40%, var(--border));
  }
</style>

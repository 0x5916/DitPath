<script lang="ts">
  import type { CharacterMastery } from '../../training/v2/types';
  import { CheckCircle2, CircleDot, AlertCircle, Circle } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';

  let {
    character,
    mastery = null
  }: {
    character: string;
    mastery?: CharacterMastery | null;
  } = $props();

  let status = $derived(mastery?.status ?? 'new');
  let statusLabel = $derived(
    {
      stable: m.learn_status_stable(),
      learning: m.progress_status_learning(),
      review: m.learn_status_review(),
      new: m.progress_status_new()
    }[status]
  );
  let accessibleLabel = $derived(
    m.progress_character_label({
      character,
      status: statusLabel,
      accuracy:
        mastery && mastery.totalAttempts > 0
          ? m.progress_accuracy_value({ percent: Math.round(mastery.rollingAccuracy * 100) })
          : m.progress_unmeasured(),
      count: mastery?.totalAttempts ?? 0
    })
  );
</script>

<span
  class="mastery-cell status-{status}"
  role="img"
  aria-label={accessibleLabel}
  title={accessibleLabel}
>
  <span class="cell-char">{character}</span>
  <span class="cell-status-icon" aria-hidden="true">
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
</span>

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
    position: relative;
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

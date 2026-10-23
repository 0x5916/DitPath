<script lang="ts">
  import type { CharacterMastery } from '../../training/v2/types';
  import InfoTip from '#lib/components/InfoTip.svelte';
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

<span class="mastery-cell status-{status}">
  <InfoTip label={accessibleLabel} text={accessibleLabel}>
    <span class="cell-char" aria-hidden="true">{character}</span>
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
  </InfoTip>
</span>

<style>
  .mastery-cell {
    display: inline-flex;
    --tip-trigger-size: 3.25rem;
    --tip-trigger-direction: column;
    --tip-trigger-gap: 0.15rem;
    --tip-trigger-background: var(--bg-surface);
    --tip-trigger-border: 1px solid var(--cell-border, var(--border));
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
    color: var(--learning-stable);
  }

  .status-learning .cell-status-icon {
    color: var(--learning-current);
  }

  .status-review .cell-status-icon {
    color: var(--learning-review);
  }

  .status-new .cell-status-icon {
    color: var(--text-muted);
  }

  .status-stable {
    --cell-border: color-mix(in srgb, var(--status-good) 30%, var(--border));
  }

  .status-review {
    --cell-border: color-mix(in srgb, var(--status-ok) 40%, var(--border));
  }
</style>

<script lang="ts">
  import * as m from '#lib/paraglide/messages.js';
  interface Props {
    current: number;
    total: number;
  }

  let { current = 1, total = 1 }: Props = $props();

  let totalCount = $derived(Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0);
  let currentCount = $derived(
    Number.isFinite(current) ? Math.min(totalCount, Math.max(0, Math.trunc(current))) : 0
  );
  let percent = $derived(totalCount > 0 ? Math.round((currentCount / totalCount) * 100) : 0);
</script>

<div
  class="session-progress"
  role="progressbar"
  aria-valuenow={percent}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label={totalCount > 0
    ? m.lesson_progress_label({ current: currentCount, total: totalCount })
    : m.lesson_progress_empty()}
>
  <div class="progress-bar-track">
    <div class="progress-bar-fill" style:width={`${percent}%`}></div>
  </div>
  <div class="progress-readout">
    <span class="progress-current">{currentCount}</span>
    <span class="progress-divider">/</span>
    <span class="progress-total">{totalCount}</span>
  </div>
</div>

<style>
  .session-progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 8rem;
  }

  .progress-bar-track {
    flex: 1;
    height: 4px;
    background-color: var(--border);
    border-radius: var(--radius-xs);
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background-color: var(--learning-current);
    transition: width var(--transition-base) var(--ease-smooth);
  }

  .progress-readout {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .progress-current {
    color: var(--text-primary);
    font-weight: 600;
  }

  .progress-divider {
    margin: 0 0.15rem;
    opacity: 0.6;
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-bar-fill {
      transition: none;
    }
  }
</style>

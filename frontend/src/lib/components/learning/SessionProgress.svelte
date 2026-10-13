<script lang="ts">
  interface Props {
    current: number;
    total: number;
  }

  let { current = 1, total = 1 }: Props = $props();

  let percent = $derived(
    total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0
  );
</script>

<div
  class="session-progress"
  role="progressbar"
  aria-valuenow={current}
  aria-valuemin={1}
  aria-valuemax={total}
  aria-label={`Progress: ${current} of ${total}`}
>
  <div class="progress-bar-track">
    <div class="progress-bar-fill" style:width={`${percent}%`}></div>
  </div>
  <div class="progress-readout">
    <span class="progress-current">{current}</span>
    <span class="progress-divider">/</span>
    <span class="progress-total">{total}</span>
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
    background-color: var(--learning-current, var(--accent));
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
</style>

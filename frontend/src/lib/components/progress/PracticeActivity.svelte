<script lang="ts">
  interface Props {
    sessionCount: number;
    totalMinutes: number;
    accuracyPercent: number;
    legacySessionCount?: number;
  }

  let {
    sessionCount = 0,
    totalMinutes = 0,
    accuracyPercent = 0,
    legacySessionCount = 0
  }: Props = $props();
</script>

<div class="activity-ledger-card" role="region" aria-label="Recent activity summary">
  <div class="ledger-head">
    <h3 class="ledger-title">Training Activity</h3>
    <span class="ledger-period">Last 7 days</span>
  </div>

  <div class="ledger-metrics">
    <div class="metric-block">
      <span class="metric-label">Sessions</span>
      <span class="metric-val">{sessionCount}</span>
    </div>
    <div class="metric-block">
      <span class="metric-label">Time practiced</span>
      <span class="metric-val">{totalMinutes} min</span>
    </div>
    <div class="metric-block">
      <span class="metric-label">Average accuracy</span>
      <span class="metric-val">{accuracyPercent}%</span>
    </div>
  </div>

  {#if legacySessionCount > 0}
    <div class="legacy-note">
      <span class="legacy-pill">Legacy history</span>
      <span>{legacySessionCount} historical passage sessions recorded prior to V2</span>
    </div>
  {/if}
</div>

<style>
  .activity-ledger-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .ledger-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .ledger-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
  }

  .ledger-period {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .ledger-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border);
  }

  .metric-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    text-align: center;
  }

  .metric-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .metric-val {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .legacy-note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }

  .legacy-pill {
    padding: 0.1rem 0.35rem;
    background-color: var(--bg-inset);
    border-radius: var(--radius-xs);
    font-weight: 600;
  }
</style>

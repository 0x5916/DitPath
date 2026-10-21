<script lang="ts">
  import * as m from '#lib/paraglide/messages.js';

  let {
    sessionCount,
    guidedSessionCount,
    practiceSessionCount,
    legacySessionCount = 0,
    totalMinutes,
    accuracyPercent,
    timedSessionCount
  }: {
    sessionCount: number;
    guidedSessionCount: number;
    practiceSessionCount: number;
    legacySessionCount?: number;
    totalMinutes: number | null;
    accuracyPercent: number | null;
    timedSessionCount: number;
  } = $props();
</script>

<div class="activity-ledger-card" role="region" aria-label={m.progress_activity_label()}>
  <div class="ledger-head">
    <h3 class="ledger-title">{m.progress_activity_title()}</h3>
    <span class="ledger-period">{m.progress_activity_period()}</span>
  </div>
  <div class="ledger-metrics">
    <div class="metric-block">
      <span class="metric-label">{m.progress_sessions()}</span>
      <span class="metric-val">{sessionCount}</span>
      <span class="metric-label"
        >{m.progress_session_breakdown({
          guided: guidedSessionCount,
          practice: practiceSessionCount
        })}</span
      >
    </div>
    <div class="metric-block">
      <span class="metric-label">{m.progress_time()}</span>
      <span class="metric-val"
        >{totalMinutes === null
          ? m.progress_unmeasured()
          : m.progress_minutes({ minutes: totalMinutes })}</span
      >
    </div>
    <div class="metric-block">
      <span class="metric-label">{m.progress_accuracy()}</span>
      <span class="metric-val"
        >{accuracyPercent === null
          ? m.progress_unmeasured()
          : m.progress_accuracy_value({ percent: accuracyPercent })}</span
      >
    </div>
  </div>
  {#if legacySessionCount > 0}
    <p class="metric-label">{m.progress_legacy_sessions({ count: legacySessionCount })}</p>
  {/if}
  {#if timedSessionCount < sessionCount}
    <p class="metric-label">{m.progress_recorded_time_hint({ count: timedSessionCount })}</p>
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
    max-width: var(--max-width-narrow);
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
</style>

<script lang="ts">
  import { lang } from '#lib/i18n.svelte.ts';
  import { accuracyClass } from '#lib/format.ts';
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

  const percentFormat = $derived(
    new Intl.NumberFormat(lang.value, { style: 'percent', maximumFractionDigits: 0 })
  );
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
      <dl class="session-breakdown">
        <div>
          <dt>{m.nav_learn()}</dt>
          <dd>{guidedSessionCount}</dd>
        </div>
        <div>
          <dt>{m.progress_free_practice()}</dt>
          <dd>{practiceSessionCount}</dd>
        </div>
      </dl>
    </div>
    <div class="metric-block">
      <span class="metric-label">{m.progress_time()}</span>
      <span class="metric-val" class:is-unmeasured={totalMinutes === null}
        >{totalMinutes === null
          ? m.progress_unmeasured()
          : m.progress_minutes({ minutes: totalMinutes })}</span
      >
    </div>
    <div class="metric-block">
      <span class="metric-label">{m.progress_accuracy()}</span>
      <div
        class={`accuracy-measure ${accuracyPercent === null ? '' : accuracyClass(accuracyPercent / 100)}`}
      >
        <span class="metric-val" class:is-unmeasured={accuracyPercent === null}
          >{accuracyPercent === null
            ? m.progress_unmeasured()
            : percentFormat.format(accuracyPercent / 100)}</span
        >
        {#if accuracyPercent !== null}
          <span class="accuracy-bar" aria-hidden="true">
            <span style:width={`${accuracyPercent}%`}></span>
          </span>
        {/if}
      </div>
    </div>
  </div>
  {#if legacySessionCount > 0}
    <p class="metric-note">{m.progress_legacy_sessions({ count: legacySessionCount })}</p>
  {/if}
  {#if timedSessionCount < sessionCount}
    <p class="metric-note">{m.progress_recorded_time_hint({ count: timedSessionCount })}</p>
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
    gap: var(--space-3);
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
    flex-shrink: 0;
  }

  .ledger-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
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
    font-weight: 500;
    letter-spacing: normal;
    text-transform: none;
  }

  .session-breakdown {
    display: grid;
    gap: var(--space-1);
    width: 100%;
    max-width: 12rem;
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    text-align: start;
  }

  .session-breakdown > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: baseline;
  }

  .session-breakdown dd {
    margin: 0;
    font-family: var(--font-mono);
    font-weight: 600;
    text-align: end;
  }

  .metric-val {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .metric-val.is-unmeasured {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
  }

  .accuracy-measure {
    display: grid;
    gap: var(--space-2);
    width: 100%;
    max-width: 10rem;
  }

  .accuracy-measure.acc-good {
    --accuracy-color: var(--status-good);
  }

  .accuracy-measure.acc-ok {
    --accuracy-color: var(--status-ok);
  }

  .accuracy-measure.acc-bad {
    --accuracy-color: var(--status-bad);
  }

  .accuracy-measure .metric-val {
    color: var(--accuracy-color, var(--text-muted));
  }

  .accuracy-bar {
    display: block;
    height: 6px;
    background: var(--border);
    overflow: hidden;
    border-radius: var(--radius-xs);
  }

  .accuracy-bar > span {
    display: block;
    height: 100%;
    background: var(--accuracy-color);
  }

  .metric-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  @media (max-width: 639px) {
    .ledger-metrics {
      grid-template-columns: 1fr;
      gap: var(--space-4);
    }
    .metric-block {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-2) var(--space-3);
      text-align: start;
      align-items: center;
    }
    .metric-val {
      text-align: end;
      overflow-wrap: anywhere;
    }
    .session-breakdown {
      grid-column: 1 / -1;
      max-width: none;
      margin: 0;
      padding-inline-start: var(--space-3);
    }
    .accuracy-measure {
      justify-self: end;
    }
  }
</style>

<script lang="ts">
  import InfoTip from '#lib/components/InfoTip.svelte';
  import { lang } from '#lib/i18n.svelte.ts';
  import { accuracyClass } from '#lib/format.ts';
  import * as m from '#lib/paraglide/messages.js';

  let {
    progressPage = false,
    sessionCount,
    guidedSessionCount,
    practiceSessionCount,
    legacySessionCount = 0,
    totalMinutes,
    accuracyPercent,
    timedSessionCount
  }: {
    progressPage?: boolean;
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

<div
  class="activity-ledger-card"
  class:progress-page={progressPage}
  role="region"
  aria-label={m.progress_activity_label()}
>
  <div class="ledger-head">
    <p class="ledger-title">{m.progress_activity_title()}</p>
    <span class="ledger-period">{m.progress_activity_period()}</span>
  </div>
  <div class="ledger-metrics">
    <div class="metric-block session-metric">
      <div class="metric-label session-label">
        <span class="session-label-text">{m.progress_sessions()}</span>
        <span class="session-tip">
          <InfoTip
            label={m.common_tip_label({ topic: m.progress_sessions() })}
            text={m.progress_session_breakdown({
              guided: guidedSessionCount,
              practice: practiceSessionCount
            })}
          />
        </span>
      </div>
      <span class="metric-val">{sessionCount}</span>
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
  .activity-ledger-card.progress-page {
    max-width: none;
    padding: var(--space-6);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
  }
  .progress-page .ledger-head {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .progress-page .ledger-title {
    font-size: var(--text-lg);
  }
  .progress-page .metric-block {
    justify-items: start;
    text-align: start;
  }
  .progress-page .metric-label {
    justify-content: flex-start;
  }
  .progress-page .session-label {
    display: flex;
  }

  .activity-ledger-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

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
    gap: 0.15rem var(--space-3);
    padding: 0;
  }

  .metric-block {
    display: grid;
    grid-row: span 2;
    grid-template-rows: subgrid;
    justify-items: center;
    align-items: start;
    gap: 0.15rem;
    text-align: center;
  }

  .metric-label {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-weight: 500;
    letter-spacing: normal;
    text-transform: none;
    align-self: stretch;
  }

  .session-label {
    --tip-trigger-size: 44px;
    display: grid;
    grid-template-columns: var(--tip-trigger-size) minmax(0, 1fr) var(--tip-trigger-size);
    width: 100%;
  }

  .session-label-text {
    grid-column: 2;
    min-width: 0;
  }

  .session-tip {
    display: inline-flex;
    grid-column: 3;
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
      grid-row: auto;
      grid-template-rows: auto;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-2) var(--space-3);
      text-align: start;
      align-items: center;
      justify-items: stretch;
    }
    .metric-val {
      text-align: end;
      overflow-wrap: anywhere;
    }
    .session-metric {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .metric-label {
      justify-content: flex-start;
    }
    .session-label {
      display: flex;
    }
    .accuracy-measure {
      justify-self: end;
    }
  }
</style>

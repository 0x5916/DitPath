<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { ApiError, getAdminOverview } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import {
    duration,
    metrics,
    metricLabels,
    metricValue,
    reportDate,
    reportHref,
    type Metric,
    type ReportPeriod,
    type OverviewReport
  } from '#lib/admin-report.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import * as m from '#lib/paraglide/messages.js';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  let {
    reportHeader,
    onPeriod,
    days,
    until,
    onDenied
  }: {
    reportHeader: Snippet<[string, ReportPeriod | null]>;
    days: number;
    until: string;
    onPeriod: (until: string) => void;
    onDenied: (status: number) => void;
  } = $props();
  const scope = createSessionScope();
  let report = $state.raw<OverviewReport | null>(null);
  let failed = $state(false);
  async function load() {
    const current = scope.begin();
    failed = false;
    try {
      const result = await getAdminOverview(days, until);
      if (current()) {
        report = result;
        onPeriod(result.period.until);
      }
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && [401, 403].includes(e.status)) onDenied(e.status);
      else failed = true;
    }
  }
  function change(metric: Metric, r: OverviewReport) {
    const diff = r.current[metric] - r.previous[metric];
    if (metric === 'duration_ms') {
      if (!r.current.measured || !r.previous.measured) return m.progress_unmeasured();
      return (diff < 0 ? '−' : diff > 0 ? '+' : '') + duration(diff);
    }
    return new Intl.NumberFormat(getLocale(), { signDisplay: 'exceptZero' }).format(diff);
  }
  onMount(() => {
    void load();
  });
  onDestroy(scope.dispose);
</script>

<section class="page-stack">
  {@render reportHeader(m.admin_overview(), report?.period ?? null)}
  {#if report}
    <div class="metrics">
      {#each metrics as metric (metric)}
        {@const peak = Math.max(...report.daily.map((d) => d[metric]), 1)}
        <a class="card-sm metric" href={reportHref('users', days, report.period.until, metric)}>
          <div class="metric-heading">
            <span class="metric-label">{metricLabels[metric]()}</span><ChevronRight
              size={16}
              aria-hidden="true"
            />
          </div>
          <strong class="metric-value">{metricValue(metric, report.current)}</strong>
          <div class="trend" aria-hidden="true">
            {#each report.daily as d (d.day)}<i style:height={`${(100 * d[metric]) / peak}%`}
              ></i>{/each}
          </div>
          <div class="metric-detail">
            <p>{m.admin_change({ change: change(metric, report) })}</p>
            {#if metric === 'sessions'}<p>{m.admin_modes(report.current)}</p>
            {:else if metric === 'duration_ms'}<p>
                {m.admin_coverage({
                  measured: report.current.measured,
                  total: report.current.sessions
                })}
              </p>{/if}
          </div>
        </a>
      {/each}
    </div>
    <details class="ui-disclosure">
      <summary>{m.admin_daily()}</summary>
      <div class="table-wrap">
        <table>
          <thead
            ><tr
              ><th>{m.admin_date()}</th>{#each metrics as metric (metric)}<th
                  >{metricLabels[metric]()}</th
                >{/each}</tr
            ></thead
          >
          <tbody
            >{#each report.daily as d (d.day)}<tr
                ><th scope="row">{reportDate(d.day)}</th>{#each metrics as metric (metric)}<td
                    >{metricValue(metric, d)}</td
                  >{/each}</tr
              >{/each}</tbody
          >
        </table>
      </div>
    </details>
    <p class="body-text">{m.admin_reporting_note()}</p>
  {:else if failed}<ErrorAlert message={m.common_load_error()} /><button
      class="btn-ghost"
      onclick={load}>{m.common_retry()}</button
    >
  {:else}<LoadingSpinner />{/if}
</section>

<style>
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .metric {
    display: grid;
    grid-row: span 4;
    grid-template-rows: subgrid;
    align-items: start;
    gap: var(--space-3);
    color: var(--text-primary);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .metric:is(:hover, :focus-visible) {
    border-color: var(--accent);
  }
  .metric-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-1);
  }
  .metric-heading :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .metric-value {
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
    text-wrap: balance;
  }
  .metric-detail {
    display: grid;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
  @media (max-width: 799px) {
    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 359px) {
    .metrics {
      grid-template-columns: 1fr;
    }
    .metric {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: auto;
      grid-row: auto;
      align-items: center;
    }
    .metric-heading,
    .metric-detail {
      grid-column: 1 / -1;
    }
  }
  .trend {
    display: flex;
    align-items: flex-end;
    gap: min(1px, 0.4%);
    height: 2rem;
    width: 100%;
    border-bottom: 1px solid var(--border);
  }
  .trend i {
    flex: 1;
    background: var(--accent);
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: var(--space-2);
    text-align: end;
    border-bottom: 1px solid var(--border);
  }
  th:first-child {
    text-align: start;
  }
  thead {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  tbody {
    font-size: var(--text-sm);
  }
</style>

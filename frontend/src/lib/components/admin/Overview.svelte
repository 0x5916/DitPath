<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, getAdminOverview } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import {
    duration,
    metrics,
    metricLabels,
    metricValue,
    rangeLabel,
    reportDate,
    reportHref,
    type Metric,
    type OverviewReport
  } from '#lib/admin-report.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import * as m from '#lib/paraglide/messages.js';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  let {
    days,
    until,
    onDenied
  }: { days: number; until: string; onDenied: (status: number) => void } = $props();
  const scope = createSessionScope();
  let report = $state.raw<OverviewReport | null>(null);
  let failed = $state(false);
  async function load() {
    const current = scope.begin();
    failed = false;
    try {
      const result = await getAdminOverview(days, until);
      if (current()) report = result;
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

{#if report}
  <section class="page-stack">
    <header>
      <h2 class="card-title">{m.admin_overview()}</h2>
      <p>{rangeLabel(report.period)}</p>
    </header>
    <div class="metrics">
      {#each metrics as metric (metric)}
        {@const peak = Math.max(...report.daily.map((d) => d[metric]), 1)}
        <a class="panel metric" href={reportHref('users', days, report.period.until, metric)}>
          <span>{metricLabels[metric]()}</span><strong>{metricValue(metric, report.current)}</strong
          >
          <div class="trend" aria-hidden="true">
            {#each report.daily as d (d.day)}<i style:height={`${(100 * d[metric]) / peak}%`}
              ></i>{/each}
          </div>
          <small>{m.admin_change({ change: change(metric, report) })}</small>
        </a>
      {/each}
    </div>
    <p>
      {m.admin_modes(report.current)}<br />{m.admin_coverage({
        measured: report.current.measured,
        total: report.current.sessions
      })}
    </p>
    <details>
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
  </section>
{:else if failed}<ErrorAlert message={m.common_load_error()} /><button
    class="btn-ghost"
    onclick={load}>{m.common_retry()}</button
  >
{:else}<LoadingSpinner />{/if}

<style>
  .metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    gap: var(--space-3);
  }
  .metric {
    min-width: 0;
    display: grid;
    gap: var(--space-2);
    text-decoration: none;
    color: inherit;
  }
  .metric strong {
    font-size: var(--text-2xl);
    font-variant-numeric: tabular-nums;
  }
  .metric:hover span {
    text-decoration: underline;
  }
  .trend {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 2rem;
    border-bottom: 1px solid var(--border);
  }
  .trend i {
    flex: 1;
    background: var(--accent);
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    padding-block: var(--space-3);
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
    text-align: start;
    border-bottom: 1px solid var(--border);
  }
</style>

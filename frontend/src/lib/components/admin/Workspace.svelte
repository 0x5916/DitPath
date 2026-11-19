<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte';
  import { page } from '$app/state';
  import {
    metrics,
    rangeLabel,
    type ReportPeriod,
    reportHref,
    type Cohort,
    type DirectoryPosition,
    type Metric
  } from '#lib/admin-report.ts';
  import * as m from '#lib/paraglide/messages.js';
  import Composer from './Composer.svelte';
  import SentMessages from './SentMessages.svelte';
  import Directory from './Directory.svelte';
  import Learner from './Learner.svelte';
  import Overview from './Overview.svelte';
  let { onDenied }: { onDenied: (status: number) => void } = $props();
  const positions: Record<string, DirectoryPosition> = {};
  let params = $derived(page.url.searchParams);
  const views = ['overview', 'users', 'compose', 'review', 'sent'] as const;
  let view = $derived(views.find((candidate) => candidate === params.get('view')) ?? 'overview');
  let message = $derived(params.get('message') ?? '');
  let days = $derived(
    [7, 90].includes(Number(params.get('days'))) ? Number(params.get('days')) : 30
  );
  let defaultUntil = $state('');
  let until = $derived(params.get('until') || defaultUntil);
  function pinPeriod(value: string) {
    if (!defaultUntil && !params.has('until')) defaultUntil = value;
  }
  let metric = $derived<Cohort>(
    metrics.includes(params.get('metric') as Metric) ? (params.get('metric') as Metric) : 'all'
  );
  let learner = $derived(params.get('learner') ?? undefined);
  let key = $derived(`${days}/${until === defaultUntil ? '' : until}/${metric}`);
  function positionFor(k: string) {
    return (positions[k] ??= { search: '', cursors: [] });
  }
</script>

<nav class="section-nav" aria-label={m.admin_title()}>
  <a
    aria-current={view === 'overview' ? 'page' : undefined}
    href={reportHref('overview', days, until, metric)}>{m.admin_overview()}</a
  >
  <a
    aria-current={view === 'users' && !learner
      ? 'page'
      : ['users', 'compose', 'review'].includes(view)
        ? 'location'
        : undefined}
    href={reportHref('users', days, until, metric)}>{m.admin_directory()}</a
  >
  <a
    aria-current={view === 'sent' ? (message ? 'location' : 'page') : undefined}
    href={reportHref('sent', days, until, metric)}>{m.mail_sent()}</a
  >
</nav>
{#snippet rangePicker()}
  <nav class="segmented" aria-label={m.admin_range()}>
    {#each [7, 30, 90] as n (n)}
      <a
        class="segmented-item"
        aria-current={days === n ? 'true' : undefined}
        href={reportHref(view, n, until, metric, learner)}>{m.admin_days({ days: n })}</a
      >
    {/each}
  </nav>
{/snippet}

{#snippet reportHeader(title: string, period: ReportPeriod | null)}
  <header class="report-toolbar">
    <div>
      <h2 class="section-title">{title}</h2>
      {#if period}<p class="body-text">{rangeLabel(period)}</p>{/if}
    </div>
    {@render rangePicker()}
  </header>
{/snippet}
{#key key}
  {#if view === 'overview'}<Overview
      {reportHeader}
      onPeriod={pinPeriod}
      {days}
      {until}
      {onDenied}
    />
  {:else if view === 'compose' || view === 'review'}
    <Composer {view} {days} {until} {metric} {onDenied} />
  {:else if view === 'sent'}
    {#key message}<SentMessages id={message} {days} {until} {metric} {onDenied} />{/key}
  {:else if learner}{#key learner}
      <div class="report-toolbar">
        <a class="crumb-link" href={reportHref('users', days, until, metric)}>
          <ChevronLeft size={16} aria-hidden="true" />{m.admin_back_directory()}
        </a>
        {@render rangePicker()}
      </div>
      <Learner id={learner} {days} {until} {onDenied} />{/key}
  {:else}<Directory
      {reportHeader}
      onPeriod={pinPeriod}
      {days}
      {until}
      {metric}
      {onDenied}
      position={positionFor(key)}
    />{/if}
{/key}

<style>
  .report-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .section-title {
    margin: 0;
  }
  .body-text {
    margin-top: var(--space-1);
  }
  .segmented-item {
    min-height: var(--answer-target-min);
  }
</style>

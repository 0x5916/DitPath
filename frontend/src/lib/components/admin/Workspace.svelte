<script lang="ts">
  import { page } from '$app/state';
  import {
    metrics,
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

<nav aria-label={m.admin_title()}>
  <a
    class="btn-ghost"
    aria-current={view === 'overview' ? 'page' : undefined}
    href={reportHref('overview', days, until, metric)}>{m.admin_overview()}</a
  >
  <a
    class="btn-ghost"
    aria-current={view === 'users' ? 'page' : undefined}
    href={reportHref('users', days, until, metric)}>{m.admin_directory()}</a
  >
  <a
    class="btn-ghost"
    aria-current={view === 'sent' ? 'page' : undefined}
    href={reportHref('sent', days, until, metric)}>{m.mail_sent()}</a
  >
</nav>
{#if view === 'users' || view === 'overview'}<nav aria-label={m.admin_range()}>
    {#each [7, 30, 90] as n (n)}<a
        class="btn-ghost"
        aria-current={days === n ? 'true' : undefined}
        href={reportHref(view, n, until, metric, learner)}>{m.admin_days({ days: n })}</a
      >{/each}
  </nav>{/if}
{#key key}
  {#if view === 'overview'}<Overview onPeriod={pinPeriod} {days} {until} {onDenied} />
  {:else if view === 'compose' || view === 'review'}
    <Composer {view} {days} {until} {metric} {onDenied} />
  {:else if view === 'sent'}
    {#key message}<SentMessages id={message} {days} {until} {metric} {onDenied} />{/key}
  {:else if learner}{#key learner}<a
        class="btn-ghost"
        href={reportHref('users', days, until, metric)}>{m.admin_back_directory()}</a
      ><Learner id={learner} {days} {until} {onDenied} />{/key}
  {:else}<Directory
      onPeriod={pinPeriod}
      {days}
      {until}
      {metric}
      {onDenied}
      position={positionFor(key)}
    />{/if}
{/key}

<style>
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  a[aria-current] {
    color: var(--accent);
    font-weight: 700;
    background: var(--bg-inset);
  }
</style>

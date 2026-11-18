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
  import Directory from './Directory.svelte';
  import Overview from './Overview.svelte';
  let { onDenied }: { onDenied: (status: number) => void } = $props();
  const positions: Record<string, DirectoryPosition> = {};
  let params = $derived(page.url.searchParams);
  let view = $derived<'users' | 'overview'>(params.get('view') === 'users' ? 'users' : 'overview');
  let days = $derived(
    [7, 90].includes(Number(params.get('days'))) ? Number(params.get('days')) : 30
  );
  let until = $derived(params.get('until') ?? '');
  let metric = $derived<Cohort>(
    metrics.includes(params.get('metric') as Metric) ? (params.get('metric') as Metric) : 'all'
  );
  let key = $derived(`${days}/${until}/${metric}`);
  function positionFor(k: string) {
    return (positions[k] ??= { search: '', cursors: [] });
  }
</script>

<nav aria-label={m.admin_title()}>
  <a
    class="btn-ghost"
    aria-current={view === 'overview' ? 'page' : undefined}
    href={reportHref('overview', days, until)}>{m.admin_overview()}</a
  >
  <a
    class="btn-ghost"
    aria-current={view === 'users' ? 'page' : undefined}
    href={reportHref('users', days, until)}>{m.admin_directory()}</a
  >
</nav>
<nav aria-label={m.admin_range()}>
  {#each [7, 30, 90] as n (n)}<a
      class="btn-ghost"
      aria-current={days === n ? 'true' : undefined}
      href={reportHref(view, n, until, metric)}>{m.admin_days({ days: n })}</a
    >{/each}
</nav>
{#key key}
  {#if view === 'overview'}<Overview {days} {until} {onDenied} />
  {:else}<Directory {days} {until} {metric} {onDenied} position={positionFor(key)} />{/if}
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

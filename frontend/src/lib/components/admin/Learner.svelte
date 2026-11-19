<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ApiError, getLearnerReport, type LearnerReport } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { duration, metricValue, rangeLabel, reportDate } from '#lib/admin-report.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import { formatPercent } from '#lib/format.ts';
  import * as m from '#lib/paraglide/messages.js';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  let {
    id,
    days,
    until,
    onDenied
  }: { id: string; days: number; until: string; onDenied: (status: number) => void } = $props();
  const scope = createSessionScope();
  let report = $state.raw<LearnerReport | null>(null);
  let error = $state('');
  let cursors = $state<string[]>([]);
  async function load() {
    const current = scope.begin();
    error = '';
    report = null;
    try {
      const result = await getLearnerReport(id, days, until, cursors.at(-1));
      if (current()) report = result;
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && [401, 403].includes(e.status)) onDenied(e.status);
      else
        error =
          e instanceof ApiError && e.status === 404
            ? m.admin_missing_account()
            : m.common_load_error();
    }
  }
  function timestamp(iso: string) {
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Singapore'
    }).format(new Date(iso));
  }
  onMount(() => {
    void load();
  });
  onDestroy(scope.dispose);
</script>

{#if report}
  <section class="page-stack">
    <header>
      <h2 class="card-title">{m.admin_learner()} · {report.account.username}</h2>
      <p>
        {report.account.email} · {report.account.email_verified
          ? m.profile_email_status_verified()
          : m.profile_email_status_not_verified()}
      </p>
      {#if report.account.call_sign}<p>
          {m.profile_call_sign_label()} · {report.account.call_sign}
        </p>{/if}
      <p>{m.profile_member_since()} · {reportDate(report.account.created_at)}</p>
      <p>
        {m.admin_last_completion()} · {report.last_completed_at
          ? timestamp(report.last_completed_at)
          : m.admin_no_completion()}
      </p>
    </header>
    <section class="panel">
      <h3>{rangeLabel(report.period)}</h3>
      <p>{m.admin_sessions()} · <strong>{report.totals.sessions}</strong></p>
      <p>{m.admin_modes(report.totals)}</p>
      <p>{m.admin_duration()} · <strong>{metricValue('duration_ms', report.totals)}</strong></p>
      <p>{m.admin_coverage({ measured: report.totals.measured, total: report.totals.sessions })}</p>
    </section>
    <h3 class="card-title">{m.admin_session_history()}</h3>
    {#if !report.sessions.length}<p>{m.admin_no_sessions()}</p>
    {:else}<ol>
        {#each report.sessions as row (row.id)}
          <li>
            <strong
              >{row.kind === 'guided'
                ? m.progress_history_lesson({ step: row.lesson })
                : row.kind === 'practice'
                  ? m.progress_history_practice_lesson({ step: row.lesson })
                  : m.progress_history_legacy_lesson({ step: row.lesson })}</strong
            >
            <p>
              <time datetime={row.occurred_at}>{timestamp(row.occurred_at)}</time> · {row.status ===
              'completed'
                ? m.history_completed()
                : m.history_abandoned()}
            </p>
            <dl>
              <div>
                <dt>{m.trainer_label_char_wpm()}</dt>
                <dd>{row.char_wpm ?? m.progress_unmeasured()}</dd>
              </div>
              <div>
                <dt>{m.trainer_label_eff_wpm()}</dt>
                <dd>{row.eff_wpm ?? m.progress_unmeasured()}</dd>
              </div>
              <div>
                <dt>{m.admin_duration()}</dt>
                <dd>
                  {row.duration_ms === null ? m.progress_unmeasured() : duration(row.duration_ms)}
                </dd>
              </div>
              <div>
                <dt>{m.profile_history_accuracy()}</dt>
                <dd>
                  {row.accuracy === null ? m.progress_unmeasured() : formatPercent(row.accuracy)}
                </dd>
              </div>
            </dl>
          </li>
        {/each}
      </ol>{/if}
    {#if cursors.length || report.next_cursor}
      <div class="controls">
        <button
          class="btn-ghost"
          disabled={!cursors.length}
          onclick={() => {
            cursors.pop();
            void load();
          }}>{m.admin_previous()}</button
        >
        <button
          class="btn-ghost"
          disabled={!report.next_cursor}
          onclick={() => {
            if (report?.next_cursor) cursors.push(report.next_cursor);
            void load();
          }}>{m.admin_next()}</button
        >
      </div>
    {/if}
  </section>
{:else if error}<ErrorAlert message={error} /><button class="btn-ghost" onclick={load}
    >{m.common_retry()}</button
  >
{:else}<LoadingSpinner />{/if}

<style>
  header,
  li {
    overflow-wrap: anywhere;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding-block: var(--space-3);
    border-block-start: 1px solid var(--border);
  }
  dl,
  .controls {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  dl {
    margin: var(--space-2) 0 0;
  }
  dt {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>

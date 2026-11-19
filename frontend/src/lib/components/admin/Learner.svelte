<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    UserRound,
    Mail,
    Radio,
    Dumbbell,
    History,
    CircleCheck,
    CircleMinus
  } from '@lucide/svelte';
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
  <section class="page-stack learner">
    <header class="panel identity">
      <div class="identity-heading">
        <span class="avatar"><UserRound size={24} aria-hidden="true" /></span>
        <div>
          <h2 class="section-title">{m.admin_learner()} · {report.account.username}</h2>
          {#if report.account.call_sign}<p class="body-text">
              {m.profile_call_sign_label()} ·
              <span class="callsign">{report.account.call_sign}</span>
            </p>{/if}
        </div>
      </div>
      <div class="contact">
        <span class="meta-item"><Mail size={16} aria-hidden="true" />{report.account.email}</span>
        <span class="meta-item verification" class:verified={report.account.email_verified}>
          {#if report.account.email_verified}<CircleCheck
              size={14}
              aria-hidden="true"
            />{m.profile_email_status_verified()}
          {:else}<CircleMinus
              size={14}
              aria-hidden="true"
            />{m.profile_email_status_not_verified()}{/if}
        </span>
      </div>
      <dl class="account-dates">
        <div>
          <dt>{m.profile_member_since()}</dt>
          <dd>{reportDate(report.account.created_at)}</dd>
        </div>
        <div>
          <dt>{m.admin_last_completion()}</dt>
          <dd>
            {report.last_completed_at
              ? timestamp(report.last_completed_at)
              : m.admin_no_completion()}
          </dd>
        </div>
      </dl>
    </header>
    <section class="panel totals">
      <h3 class="card-title">{rangeLabel(report.period)}</h3>
      <dl class="summary-metrics">
        <div>
          <dt>{m.admin_sessions()}</dt>
          <dd class="metric-value">{report.totals.sessions}</dd>
          <dd class="body-text">{m.admin_modes(report.totals)}</dd>
        </div>
        <div>
          <dt>{m.admin_duration()}</dt>
          <dd class="metric-value">{metricValue('duration_ms', report.totals)}</dd>
          <dd class="body-text">
            {m.admin_coverage({ measured: report.totals.measured, total: report.totals.sessions })}
          </dd>
        </div>
      </dl>
    </section>
    <section>
      <h3 class="section-title">{m.admin_session_history()}</h3>
      {#if !report.sessions.length}<p class="body-text">{m.admin_no_sessions()}</p>
      {:else}<ol class="row-list" role="list">
          {#each report.sessions as row (row.id)}
            <li class="history-row">
              <div class="session-copy">
                <strong class="session-title">
                  {#if row.kind === 'guided'}<Radio
                      size={18}
                      aria-hidden="true"
                    />{m.progress_history_lesson({ step: row.lesson })}
                  {:else if row.kind === 'practice'}<Dumbbell
                      size={18}
                      aria-hidden="true"
                    />{m.progress_history_practice_lesson({ step: row.lesson })}
                  {:else}<History size={18} aria-hidden="true" />{m.progress_history_legacy_lesson({
                      step: row.lesson
                    })}{/if}
                </strong>
                <p class="meta-row">
                  <time datetime={row.occurred_at}>{timestamp(row.occurred_at)}</time>
                  <span class="meta-item status" class:complete={row.status === 'completed'}
                    >{#if row.status === 'completed'}<CircleCheck
                        size={14}
                        aria-hidden="true"
                      />{m.history_completed()}{:else}<CircleMinus
                        size={14}
                        aria-hidden="true"
                      />{m.history_abandoned()}{/if}</span
                  >
                </p>
              </div>
              <dl class="session-metrics">
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
    </section>
    {#if cursors.length || report.next_cursor}
      <div class="composer-actions">
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
  .learner {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .identity,
  .totals,
  .session-copy {
    display: grid;
    gap: var(--space-4);
  }
  .identity-heading,
  .contact,
  .session-title {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .identity-heading h2,
  .identity-heading p,
  .totals h3,
  dl,
  dd {
    margin: 0;
  }
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--answer-target-min);
    height: var(--answer-target-min);
    border-radius: var(--radius-md);
    background: var(--bg-inset);
    color: var(--text-secondary);
  }
  .contact {
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }
  .contact :global(svg),
  .session-title :global(svg) {
    flex: none;
  }
  .verification,
  .status {
    font-size: var(--text-xs);
    color: var(--status-ok);
  }
  .verified,
  .complete {
    color: var(--status-good);
  }
  .account-dates,
  .summary-metrics,
  .session-metrics {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  dt {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  dd {
    margin-top: var(--space-1);
    font-variant-numeric: tabular-nums;
  }
  .account-dates dd,
  .session-metrics dd {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .summary-metrics .metric-value {
    font-size: var(--text-xl);
    font-weight: 600;
  }
  .history-row {
    display: grid;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--border);
  }
  .history-row:first-child {
    padding-top: 0;
  }
  .session-copy,
  .session-title {
    gap: var(--space-2);
  }
  .session-title :global(svg) {
    color: var(--accent);
  }
  .session-metrics dt {
    font-size: var(--text-xs);
  }
  @media (min-width: 760px) {
    .history-row {
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: var(--space-6);
    }
    .session-metrics {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @media (max-width: 480px) {
    .summary-metrics {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

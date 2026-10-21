<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { user } from '#lib/auth.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { getUserInfo, getCWSettings } from '#lib/api.ts';
  import type { HistorySessionRecord } from '#lib/training/v2/types.ts';
  import { sessionOccurredAt as historyDate } from '#lib/training/v2/progress-summary.ts';
  import { openTrainingDb, closeTrainingDb } from '#lib/data/training-db.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import ProfileHeatmap from '#lib/components/profile/ProfileHeatmap.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync,
    syncTrainingNow
  } from '#lib/training-sync.svelte.ts';
  import { readClientCwSettings } from '#lib/cwSync.ts';
  import { utcDayStart } from '#lib/profile-heatmap.ts';
  import { Calendar, Check, X } from '@lucide/svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { accuracyClass, formatDate, formatLesson, percentage } from '#lib/format.ts';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';

  const loadScope = createSessionScope();
  onDestroy(() => {
    loadScope.dispose();
  });

  let loading = $state(true);
  let loadError = $state('');

  let username = $state('');
  let email = $state('');
  let callSign = $state<string | null>(null);
  let emailVerified = $state(false);
  let accountInfoKnown = $state(false);
  let deviceSettings = $state(true);
  let earliestHistoryMs = $state<number | null>(null);
  let memberSince = $state('');
  let memberCreatedAtMs = $state<number | null>(null);
  let charWpm = $state<number | null>(null);
  let effWpm = $state<number | null>(null);
  let freq = $state<number | null>(null);
  let records = $state<HistorySessionRecord[]>([]);
  let loadToken = 0;

  let isGuest = $derived(!$user);
  let recentRecords = $derived(records.slice(0, 20));

  onMount(() => {
    let revision = '';
    const unsubscribe = subscribeTrainingSync((state) => {
      const next = `${state.owner}:${state.version}`;
      if (revision === next) return;
      revision = next;
      void loadAll();
    });
    return unsubscribe;
  });

  async function loadAll() {
    const owner = getTrainingOwner();
    const active = loadScope.begin();
    const token = ++loadToken;
    const current = () => active() && token === loadToken && owner === getTrainingOwner();
    loading = true;
    loadError = '';
    records = [];
    username = owner === 'unclaimed' ? m.nav_guest() : ($user?.username ?? '');
    email = '';
    callSign = null;
    emailVerified = false;
    accountInfoKnown = false;
    memberSince = m.progress_unmeasured();
    memberCreatedAtMs = null;
    earliestHistoryMs = null;
    charWpm = null;
    effWpm = null;
    freq = null;
    try {
      const deviceCw = readClientCwSettings();
      charWpm = deviceCw.char_wpm;
      effWpm = deviceCw.eff_wpm;
      freq = deviceCw.freq;
    } catch {
      // Browser settings storage can be blocked independently of IndexedDB history.
    }
    deviceSettings = true;
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      if (!current()) return;
      const history = await createSessionRepository(db, owner).getSessions();
      if (!current()) return;
      records = history.filter((record) => record.status !== 'in-progress');
      const times = history
        .map((record) => Date.parse(historyDate(record)))
        .filter(Number.isFinite);
      earliestHistoryMs = times.length ? Math.min(...times) : null;
      if (owner === 'unclaimed') {
        const createdMs = earliestHistoryMs;
        memberCreatedAtMs = createdMs === null ? null : utcDayStart(createdMs);
        memberSince = createdMs === null ? m.progress_unmeasured() : formatMemberSince(createdMs);
      } else {
        // Account details are optional: cached history remains usable while offline.
        void getUserInfo()
          .then((info) => {
            if (!current()) return;
            username = info.username;
            email = info.email;
            callSign = info.call_sign;
            emailVerified = info.email_verified;
            accountInfoKnown = true;
            const createdMs = Date.parse(info.created_at);
            memberCreatedAtMs = Number.isFinite(createdMs) ? utcDayStart(createdMs) : null;
            memberSince = Number.isFinite(createdMs)
              ? formatMemberSince(createdMs)
              : m.progress_unmeasured();
          })
          .catch(() => {});
        void getCWSettings()
          .then((cw) => {
            if (!current()) return;
            charWpm = cw.char_wpm;
            effWpm = cw.eff_wpm;
            freq = cw.freq;
            deviceSettings = false;
          })
          .catch(() => {});
      }
    } catch (error) {
      if (current()) loadError = localizeApiError(error, () => m.common_load_error());
    } finally {
      if (db) closeTrainingDb(db);
      if (current()) loading = false;
    }
  }

  function formatMemberSince(createdMs: number): string {
    return new Date(createdMs).toLocaleDateString(getLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
</script>

<div class="page-stack">
  <TrainingSyncStatus
    owner={trainingSyncState.owner}
    pending={trainingSyncState.pending}
    error={trainingSyncState.error}
    syncing={trainingSyncState.syncing}
    synced={trainingSyncState.synced}
    onSync={() => void syncTrainingNow()}
  />
  {#if loading}
    <LoadingSpinner />
  {:else if loadError}
    <ErrorAlert message={loadError} />
    <button type="button" class="btn-ghost" onclick={() => void loadAll()}
      >{m.common_retry()}</button
    >
  {:else}
    {#if isGuest}
      <div class="notice">
        <GuestNotice class="body-text" />
      </div>
    {/if}

    <!-- Header: identity block, not a card. -->
    <header class="profile-header">
      <!-- Call-sign plate: the one piece of radio identity, in monospace. -->
      <div class="profile-stat profile-plate">
        <span class="metric-value"
          >{!isGuest && !accountInfoKnown
            ? m.progress_unmeasured()
            : (callSign ?? m.profile_call_sign_none())}</span
        >
        <span class="metric-label">{m.profile_call_sign_label()}</span>
      </div>
      <div class="profile-header-info">
        <h1 class="page-title">{username}</h1>
        {#if !isGuest && accountInfoKnown}
          <p class="profile-email">{email}</p>
        {/if}
        <div class="meta-row">
          {#if !isGuest && accountInfoKnown}
            <p class="meta-item">
              {#if emailVerified}
                <Check
                  size={14}
                  class="profile-status-icon profile-status-icon-ok"
                  aria-hidden="true"
                />
              {:else}
                <X
                  size={14}
                  class="profile-status-icon profile-status-icon-bad"
                  aria-hidden="true"
                />
              {/if}
              <span
                >{emailVerified
                  ? m.profile_email_status_verified()
                  : m.profile_email_status_not_verified()}</span
              >
            </p>
          {/if}
        </div>
        {#if !isGuest && !accountInfoKnown}<p class="body-text">
            {m.profile_account_details_unavailable()}
          </p>{/if}
        <p class="profile-joined">
          <Calendar size={13} />
          {m.profile_member_since()}: {memberSince}
        </p>
      </div>
    </header>

    <ProfileHeatmap {records} {memberCreatedAtMs} {earliestHistoryMs} />

    <!-- CW settings snapshot: peer readouts in an inset stat strip. -->
    <section class="panel">
      <h2 class="card-title">{m.profile_cw_settings()}</h2>
      {#if !isGuest && deviceSettings}<p class="body-text">
          {m.profile_device_settings_hint()}
        </p>{/if}
      <div class="profile-cw-grid">
        <div class="profile-stat">
          <span class="metric-value">{charWpm ?? m.progress_unmeasured()}</span>
          <span class="metric-label">{m.profile_cw_char_wpm()}</span>
        </div>
        <div class="profile-stat">
          <span class="metric-value">{effWpm ?? m.progress_unmeasured()}</span>
          <span class="metric-label">{m.profile_cw_eff_wpm()}</span>
        </div>
        <div class="profile-stat">
          <span class="metric-value">{freq === null ? m.progress_unmeasured() : `${freq} Hz`}</span>
          <span class="metric-label">{m.profile_cw_freq()}</span>
        </div>
      </div>
    </section>

    <!-- Progress history: dense tabular data, the table is the content. -->
    <section class="panel">
      <h2 class="card-title">{m.profile_history()}</h2>
      {#if recentRecords.length === 0}
        <p class="body-text profile-empty">
          {m.profile_history_empty()}
          <a href={localizedHref('/morse/learn')} class="link">{m.nav_learn()}</a>
        </p>
      {:else}
        <div class="profile-table-wrap">
          <table class="profile-table">
            <thead>
              <tr>
                <th class="panel-label">{m.profile_history_lesson()}</th>
                <th class="panel-label">{m.history_status()}</th>
                <th class="panel-label">{m.profile_history_accuracy()}</th>
                <th class="panel-label">{m.profile_history_wpm()}</th>
                <th class="panel-label">{m.profile_history_date()}</th>
              </tr>
            </thead>
            <tbody>
              {#each recentRecords as rec (rec.id)}
                <tr>
                  <td class="profile-lesson-cell"
                    >{rec.mode === 'legacy'
                      ? m.history_legacy()
                      : rec.mode === 'practice'
                        ? m.progress_history_practice()
                        : m.progress_history_guided()} · {formatLesson(String(rec.step))}</td
                  >
                  <td
                    >{rec.status === 'abandoned'
                      ? m.history_abandoned()
                      : m.history_completed()}</td
                  >
                  <td
                    ><span
                      class="profile-acc {rec.accuracy == null ? '' : accuracyClass(rec.accuracy)}"
                      >{rec.accuracy == null
                        ? m.progress_unmeasured()
                        : percentage(rec.accuracy)}</span
                    ></td
                  >
                  <td class="profile-wpm-cell"
                    >{rec.charWpm ?? m.progress_unmeasured()} / {rec.effWpm ??
                      m.progress_unmeasured()}</td
                  >
                  <td class="profile-date-cell">{formatDate(historyDate(rec))}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  /* The default width tier plus `.page-stack` rhythm: this page is a dashboard
     (heatmap, stat strip, four-column table), not a single-column form, and at
     42rem the ~834px heatmap was force-scrolling. `.page-stack` keeps the
     inter-block rhythm that `.page-narrow` used to provide. */

  /* Header: identity block delimited by a rule, not a card. */
  .profile-header {
    display: flex;
    align-items: center;
    gap: var(--block-gap);
    padding-bottom: var(--space-5);
    border-bottom: 1px solid var(--border);
  }
  /* One inset box for the page's readouts: the call-sign plate and the CW
     stat strip share it. */
  .profile-stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background-color: var(--bg-inset);
    min-width: 0;
  }
  .profile-plate {
    align-items: center;
    justify-content: center;
    min-width: 6rem;
    flex-shrink: 0;
  }
  .profile-header-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .profile-email {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }
  .profile-joined {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
  }
  :global(.profile-status-icon) {
    flex-shrink: 0;
  }
  :global(.profile-status-icon-ok) {
    color: var(--status-good);
  }
  :global(.profile-status-icon-bad) {
    color: var(--status-bad);
  }

  /* CW settings: peer readouts in an inset stat strip; values and labels reuse
     the shared `.metric-value` / `.metric-label` pair. */
  .profile-cw-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  /* History table */
  .profile-table-wrap {
    overflow-x: auto;
  }
  .profile-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .profile-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .profile-table td {
    padding: 0.6rem 0.75rem;
    color: var(--text-secondary);
  }
  .profile-table tbody tr:hover td {
    background-color: var(--bg-inset);
  }
  /* `.profile-table td` colours every cell secondary; this cell wins on
     specificity rather than with a blanket `!important`. */
  .profile-table td.profile-lesson-cell {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    letter-spacing: 0.12em;
  }
  /* Accuracy reads as a value with a status dot, not as a coloured pill. */
  .profile-acc {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }
  .profile-acc::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--acc-color, var(--text-muted));
    flex-shrink: 0;
  }
  .acc-good {
    --acc-color: var(--status-good);
  }
  .acc-ok {
    --acc-color: var(--status-ok);
  }
  .acc-bad {
    --acc-color: var(--status-bad);
  }
  .profile-wpm-cell {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .profile-date-cell {
    white-space: nowrap;
    font-size: var(--text-xs);
  }
  .profile-empty {
    color: var(--text-muted);
    padding: var(--space-2) 0;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .profile-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { user } from '#lib/auth.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { getUserInfo } from '#lib/api.ts';
  import type { HistorySessionRecord } from '#lib/training/v2/types.ts';
  import { sessionOccurredAt as historyDate } from '#lib/training/v2/progress-summary.ts';
  import { openTrainingDb, closeTrainingDb } from '#lib/data/training-db.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import ProfileHeatmap from '#lib/components/profile/ProfileHeatmap.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync
  } from '#lib/training-sync.svelte.ts';
  import { buildTrainingHabits, utcDayStart } from '#lib/profile-heatmap.ts';
  import { Calendar, Check, X, Mail, UserRound, Settings } from '@lucide/svelte';
  import InfoTip from '#lib/components/InfoTip.svelte';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import { localizeApiError } from '#lib/errorLocalization.ts';
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
  let earliestHistoryMs = $state<number | null>(null);
  let memberSince = $state('');
  let memberCreatedAtMs = $state<number | null>(null);
  let records = $state<HistorySessionRecord[]>([]);
  let loadToken = 0;
  let loadedOwner: string | null = null;

  let isGuest = $derived(!$user);
  const habitYear = new Date().getUTCFullYear();
  const habits = $derived(buildTrainingHabits(records, habitYear, Date.now()));
  const favoriteWeekday = $derived(
    habits.favoriteWeekday === null
      ? m.progress_unmeasured()
      : new Intl.DateTimeFormat(getLocale(), { weekday: 'long', timeZone: 'UTC' }).format(
          Date.UTC(2024, 0, 7 + habits.favoriteWeekday)
        )
  );

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
    // Preserve the profile during same-owner refreshes; never retain another account's data.
    if (owner !== loadedOwner) {
      loadedOwner = null;
      loading = true;
      records = [];
      username = owner === 'unclaimed' ? m.nav_guest() : ($user?.username ?? '');
      email = '';
      callSign = null;
      emailVerified = false;
      accountInfoKnown = false;
      memberSince = m.progress_unmeasured();
      memberCreatedAtMs = null;
      earliestHistoryMs = null;
    }
    loadError = '';
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      if (!current()) return;
      const history = await createSessionRepository(db, owner).getSessions();
      if (!current()) return;
      records = history.filter((record) => record.status !== 'in-progress');
      loadedOwner = owner;
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

<svelte:head>
  <title>{m.nav_profile()} · OpenCW</title>
</svelte:head>

<div class="page-stack">
  <header class="profile-header">
    <div class="profile-heading-row">
      <h1 class="page-title">{m.nav_profile()}</h1>
      <a
        href={localizedHref('/settings')}
        class="profile-settings"
        aria-label={m.nav_settings()}
        title={m.nav_settings()}><Settings size={20} aria-hidden="true" /></a
      >
    </div>
    {#if !loading && !loadError}
      <div class="profile-identity">
        <div class="profile-identity-main">
          <div class="profile-avatar" aria-hidden="true">
            <UserRound size={32} />
          </div>
          <div class="profile-identity-title">
            <p class="profile-name">{username}</p>
            {#if !isGuest && accountInfoKnown && callSign}
              <p class="profile-call-sign">
                <span>{m.profile_call_sign_label()}</span>
                <strong>{callSign}</strong>
              </p>
            {/if}
          </div>
        </div>
        {#if isGuest}
          <p class="body-text">{m.profile_guest_summary()}</p>
          <div class="profile-actions">
            <a href={localizedHref('/login')} class="btn-primary">{m.nav_login()}</a>
            <a href={localizedHref('/register')} class="btn-ghost">{m.nav_register()}</a>
          </div>
        {:else if accountInfoKnown}
          <div class="profile-details">
            <div class="profile-email-row">
              <Mail size={16} class="profile-detail-icon" aria-hidden="true" />
              <div class="profile-email-copy">
                <p class="profile-email">{email}</p>
                <p class="profile-email-status">
                  {#if emailVerified}
                    <Check size={14} class="profile-status-icon-ok" aria-hidden="true" />
                  {:else}
                    <X size={14} class="profile-status-icon-bad" aria-hidden="true" />
                  {/if}
                  <span
                    >{emailVerified
                      ? m.profile_email_status_verified()
                      : m.profile_email_status_not_verified()}</span
                  >
                </p>
              </div>
            </div>
            <p class="profile-meta">
              <Calendar size={16} class="profile-detail-icon" aria-hidden="true" />
              <span>{m.profile_member_since()}: {memberSince}</span>
            </p>
          </div>
        {:else}
          <p class="body-text">{m.profile_account_details_unavailable()}</p>
        {/if}
      </div>
    {/if}
  </header>

  <TrainingSyncStatus
    owner={trainingSyncState.owner}
    pending={trainingSyncState.pending}
    error={trainingSyncState.error}
    syncing={trainingSyncState.syncing}
    synced={trainingSyncState.synced}
  />

  {#if loading}
    <LoadingSpinner />
  {:else if loadError}
    <ErrorAlert message={loadError} />
    <button type="button" class="btn-ghost" onclick={() => void loadAll()}
      >{m.common_retry()}</button
    >
  {:else}
    <ProfileHeatmap {records} {memberCreatedAtMs} {earliestHistoryMs} />
    <section class="panel" aria-labelledby="profile-habits-title">
      <div class="profile-habits-header">
        <h2 id="profile-habits-title" class="card-title">
          {m.profile_habits_title({ year: String(habitYear) })}
        </h2>
        <InfoTip
          label={m.profile_habits_title({ year: String(habitYear) })}
          text={m.profile_habits_info({ year: String(habitYear) })}
        />
      </div>
      <dl class="profile-habits">
        <div>
          <dt>{m.profile_habits_active_days()}</dt>
          <dd>{habits.activeDays}</dd>
        </div>
        <div>
          <dt>{m.profile_habits_longest_streak()}</dt>
          <dd>
            {habits.longestStreak === 1
              ? m.profile_habits_day_one()
              : m.profile_habits_days({ count: String(habits.longestStreak) })}
          </dd>
        </div>
        <div>
          <dt>{m.profile_habits_favorite_weekday()}</dt>
          <dd>{favoriteWeekday}</dd>
        </div>
      </dl>
    </section>
  {/if}
</div>

<style>
  .profile-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .profile-header .page-title {
    margin: 0;
  }

  .profile-heading-row,
  .profile-habits-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .profile-settings {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--answer-target-min);
    height: var(--answer-target-min);
    color: var(--text-muted);
    border-radius: var(--radius-sm);
  }

  .profile-settings:hover {
    color: var(--accent);
    background: var(--bg-inset);
  }

  .profile-settings:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .profile-habits-header .card-title {
    margin: 0;
  }

  .profile-habits {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
    margin: var(--space-4) 0 0;
  }

  .profile-habits > div {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .profile-habits dt {
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--text-muted);
  }

  .profile-habits dd {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text-primary);
  }

  @media (max-width: 479px) {
    .profile-habits {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .profile-habits > div:last-child {
      grid-column: 1 / -1;
      padding-top: var(--space-4);
      border-top: 1px solid var(--border);
    }
  }

  .profile-identity {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    overflow-wrap: anywhere;
  }

  .profile-identity-main {
    display: grid;
    grid-template-columns: 4rem minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
  }

  .profile-avatar {
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-inset);
    color: var(--text-secondary);
    overflow: hidden;
  }

  .profile-identity-title {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .profile-name {
    margin: 0;
    font-size: var(--text-xl);
    line-height: 1.3;
    font-weight: 600;
    color: var(--text-primary);
  }

  .profile-email,
  .profile-call-sign {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .profile-call-sign {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .profile-call-sign strong {
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .profile-details {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .profile-email-row,
  .profile-meta,
  .profile-email-status {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
  }

  .profile-email-copy {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .profile-meta,
  .profile-email-status {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .profile-email-status :global(svg) {
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  :global(.profile-detail-icon) {
    flex-shrink: 0;
    margin-top: 0.125rem;
    color: var(--text-muted);
  }

  :global(.profile-status-icon-ok) {
    color: var(--status-good);
  }

  :global(.profile-status-icon-bad) {
    color: var(--status-bad);
  }

  .profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .profile-actions a {
    min-height: var(--answer-target-min);
  }

  .profile-identity .body-text {
    margin: 0;
  }
</style>

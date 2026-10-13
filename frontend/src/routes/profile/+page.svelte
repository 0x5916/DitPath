<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/auth';
  import { getUserInfo, getCWSettings, getProgress } from '$lib/api';
  import type { ProgressRecord } from '$lib/api';
  import { readClientCwSettings } from '$lib/cwSync';
  import { getLocalProgressRecords } from '$lib/progressSync';
  import { Calendar, Check, X } from '@lucide/svelte';
  import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
  import ErrorAlert from '$lib/components/ErrorAlert.svelte';
  import GuestNotice from '$lib/components/GuestNotice.svelte';
  import { localizeApiError } from '$lib/errorLocalization';
  import { accuracyClass, formatDate, formatLesson, percentage } from '$lib/format';
  import { localizedHref } from '$lib/i18n.svelte';
  import * as m from '$lib/paraglide/messages';

  let loading = $state(true);
  let loadError = $state('');

  let username = $state('');
  let email = $state('');
  let callSign = $state<string | null>(null);
  let emailVerified = $state(false);
  let memberSince = $state('');
  let memberCreatedAtMs = $state<number | null>(null);
  let selectedYear = $state(new Date().getFullYear());
  let charWpm = $state(0);
  let effWpm = $state(0);
  let freq = $state(0);
  let records = $state<ProgressRecord[]>([]);
  let heatmapScrollEl = $state<HTMLDivElement | null>(null);
  let lastAuthLoaded = $state<boolean | null>(null);

  // Locale-dependent, so it is derived on the component instance: a
  // module-level constant would not be re-evaluated when the language changes.
  let weekdayLabels = $derived([
    m.profile_heatmap_weekday_mon(),
    '',
    m.profile_heatmap_weekday_wed(),
    '',
    m.profile_heatmap_weekday_fri(),
    '',
    ''
  ]);
  const CURRENT_YEAR = new Date().getFullYear();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const DAY_OF_MONTH_UTC_FORMATTER = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    timeZone: 'UTC'
  });
  const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  type HeatmapCell = {
    dateMs: number;
    dateKey: string;
    count: number;
    level: 0 | 1 | 2 | 3 | 4;
    outsideYear: boolean;
    beforeAccount: boolean;
    inFuture: boolean;
  };

  type HeatmapWeek = {
    startMs: number;
    monthLabel: string;
    cells: HeatmapCell[];
  };

  let availableYears = $derived(getAvailableYears(memberCreatedAtMs));
  let yearTotalSessions = $derived(countSessionsForYear(records, selectedYear));
  let heatmapWeeks = $derived(buildHeatmap(records, memberCreatedAtMs, selectedYear));
  let heatmapWeekCount = $derived(Math.max(1, heatmapWeeks.length));
  let todayDayMs = $derived(utcDayStart(Date.now()));
  let recentRecords = $derived([...records].reverse().slice(0, 20));
  let isGuest = $derived(!$user);

  $effect(() => {
    const isAuthenticated = Boolean($user);
    if (lastAuthLoaded === isAuthenticated) return;

    lastAuthLoaded = isAuthenticated;
    loadAll();
  });

  function scrollHeatmapToEnd() {
    if (!heatmapScrollEl) return;
    heatmapScrollEl.scrollLeft = Math.max(
      0,
      heatmapScrollEl.scrollWidth - heatmapScrollEl.clientWidth
    );
  }

  function scrollHeatmapToCurrentWeek() {
    if (!heatmapScrollEl) return;

    const currentWeekEl = heatmapScrollEl.querySelector(
      '.profile-heatmap-week.is-current-week'
    ) as HTMLElement | null;
    const currentDayEl = heatmapScrollEl.querySelector(
      '.profile-heatmap-cell.is-today'
    ) as HTMLElement | null;
    const targetEl = currentWeekEl ?? currentDayEl;

    if (!targetEl) {
      scrollHeatmapToEnd();
      return;
    }

    const rightPadding = 8;
    const containerRect = heatmapScrollEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const target =
      heatmapScrollEl.scrollLeft + (targetRect.right - containerRect.right) + rightPadding;
    const maxScroll = Math.max(0, heatmapScrollEl.scrollWidth - heatmapScrollEl.clientWidth);
    heatmapScrollEl.scrollLeft = Math.max(0, Math.min(maxScroll, target));
  }

  onMount(() => {
    requestAnimationFrame(() => {
      if (selectedYear === CURRENT_YEAR) {
        scrollHeatmapToCurrentWeek();
      } else {
        if (!heatmapScrollEl) return;
        heatmapScrollEl.scrollLeft = 0;
      }
    });
  });

  $effect(() => {
    if (!availableYears.includes(selectedYear)) {
      selectedYear = availableYears[0] ?? new Date().getFullYear();
    }
  });

  $effect(() => {
    const weekCount = heatmapWeeks.length;
    if (weekCount === 0 || !heatmapScrollEl) return;

    requestAnimationFrame(() => {
      if (!heatmapScrollEl) return;
      if (selectedYear === CURRENT_YEAR) {
        scrollHeatmapToCurrentWeek();
      } else {
        heatmapScrollEl.scrollLeft = 0;
      }
    });
  });

  async function loadAll() {
    loading = true;
    loadError = '';

    if (!$user) {
      const cw = readClientCwSettings();
      const localRecords = getLocalProgressRecords();
      const parsedCreatedAt = localRecords
        .map((record) => Date.parse(record.created_at))
        .filter((value) => !Number.isNaN(value));
      const earliestCreatedAtMs =
        parsedCreatedAt.length === 0 ? Date.now() : Math.min(...parsedCreatedAt);

      username = m.nav_guest();
      email = '';
      callSign = null;
      emailVerified = false;
      memberCreatedAtMs = utcDayStart(earliestCreatedAtMs);
      memberSince = new Date(earliestCreatedAtMs).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      selectedYear = new Date().getFullYear();
      charWpm = cw.char_wpm;
      effWpm = cw.eff_wpm;
      freq = cw.freq;
      records = localRecords;
      loading = false;
      return;
    }

    try {
      const [info, cw, prog] = await Promise.all([getUserInfo(), getCWSettings(), getProgress()]);
      username = info.username;
      email = info.email;
      callSign = info.call_sign;
      emailVerified = info.email_verified;
      memberSince = new Date(info.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      {
        const createdAtParsedMs = Date.parse(info.created_at);
        memberCreatedAtMs = Number.isNaN(createdAtParsedMs) ? null : utcDayStart(createdAtParsedMs);
      }
      selectedYear = new Date().getFullYear();
      charWpm = cw.char_wpm;
      effWpm = cw.eff_wpm;
      freq = cw.freq;
      records = prog;
    } catch (e) {
      loadError = localizeApiError(e, () => m.common_load_error());
    } finally {
      loading = false;
    }
  }

  function utcDayStart(ms: number): number {
    return Math.floor(ms / DAY_MS) * DAY_MS;
  }

  function mondayIndexFromDayNumber(dayNumber: number): number {
    return (((dayNumber + 3) % 7) + 7) % 7;
  }

  function startOfWeekMondayMs(ms: number): number {
    const dayStart = utcDayStart(ms);
    const dayNumber = Math.floor(dayStart / DAY_MS);
    return dayStart - mondayIndexFromDayNumber(dayNumber) * DAY_MS;
  }

  function addDaysMs(ms: number, days: number): number {
    return ms + days * DAY_MS;
  }

  function toDateKey(ms: number): string {
    return String(ms);
  }

  function monthLabelForWeek(weekStartMs: number, todayMs: number): string {
    for (let offset = 0; offset < 7; offset += 1) {
      const dayMs = addDaysMs(weekStartMs, offset);
      if (dayMs > todayMs) break;
      if (DAY_OF_MONTH_UTC_FORMATTER.format(dayMs) === '1') {
        return MONTH_FORMATTER.format(dayMs);
      }
    }

    return '';
  }

  function contributionLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
    if (count <= 0) return 0;
    if (maxCount <= 1) return 4;
    const scaled = Math.ceil((count / maxCount) * 4);
    return Math.min(4, Math.max(1, scaled)) as 1 | 2 | 3 | 4;
  }

  function getAvailableYears(createdAtMs: number | null): number[] {
    const currentYear = new Date().getFullYear();
    const startYear = createdAtMs === null ? currentYear : new Date(createdAtMs).getFullYear();

    const years: number[] = [];
    for (let year = currentYear; year >= startYear; year -= 1) {
      years.push(year);
    }

    return years;
  }

  function countSessionsForYear(items: ProgressRecord[], year: number): number {
    let count = 0;
    for (const rec of items) {
      const parsedMs = Date.parse(rec.created_at);
      if (Number.isNaN(parsedMs)) continue;
      if (new Date(parsedMs).getUTCFullYear() === year) {
        count += 1;
      }
    }
    return count;
  }

  function buildHeatmap(
    items: ProgressRecord[],
    createdAtMs: number | null,
    year: number
  ): HeatmapWeek[] {
    const todayMs = utcDayStart(Date.now());
    const yearStartMs = utcDayStart(Date.UTC(year, 0, 1));
    const yearEndMs = utcDayStart(Date.UTC(year, 11, 31));
    const startWeekStartMs = startOfWeekMondayMs(yearStartMs);
    const endWeekStartMs = startOfWeekMondayMs(yearEndMs);
    const weekCount = Math.max(
      1,
      Math.floor((endWeekStartMs - startWeekStartMs) / (7 * DAY_MS)) + 1
    );

    const byDay: Record<string, number> = {};

    for (const rec of items) {
      const parsedMs = Date.parse(rec.created_at);
      if (Number.isNaN(parsedMs)) continue;

      const dayMs = utcDayStart(parsedMs);
      if (dayMs < yearStartMs || dayMs > yearEndMs) continue;
      if (createdAtMs !== null && dayMs < utcDayStart(createdAtMs)) continue;
      if (dayMs > todayMs) continue;

      const key = toDateKey(dayMs);
      byDay[key] = (byDay[key] ?? 0) + 1;
    }

    let maxCount = 0;
    for (const count of Object.values(byDay)) {
      if (count > maxCount) maxCount = count;
    }

    const weeks: HeatmapWeek[] = [];

    for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
      const weekStartMs = addDaysMs(startWeekStartMs, weekIndex * 7);
      const cells: HeatmapCell[] = [];

      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const dateMs = addDaysMs(weekStartMs, dayIndex);
        const dateKey = toDateKey(dateMs);
        const outsideYear = dateMs < yearStartMs || dateMs > yearEndMs;
        const beforeAccount = createdAtMs !== null && dateMs < utcDayStart(createdAtMs);
        const inFuture = dateMs > todayMs;
        const count = outsideYear || inFuture || beforeAccount ? 0 : (byDay[dateKey] ?? 0);

        cells.push({
          dateMs,
          dateKey,
          count,
          level: outsideYear || inFuture || beforeAccount ? 0 : contributionLevel(count, maxCount),
          outsideYear,
          beforeAccount,
          inFuture
        });
      }

      weeks.push({
        startMs: weekStartMs,
        monthLabel: monthLabelForWeek(weekStartMs, yearEndMs),
        cells
      });
    }

    if (weeks[0] && weeks[0].monthLabel === '') {
      weeks[0].monthLabel = MONTH_FORMATTER.format(weeks[0].startMs);
    }

    return weeks;
  }
</script>

<div class="page-stack">
  {#if loading}
    <LoadingSpinner />
  {:else if loadError}
    <ErrorAlert message={loadError} />
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
        <span class="metric-value">{callSign ?? m.profile_call_sign_none()}</span>
        <span class="metric-label">{m.profile_call_sign_label()}</span>
      </div>
      <div class="profile-header-info">
        <h1 class="page-title">{username}</h1>
        {#if !isGuest}
          <p class="profile-email">{email}</p>
        {/if}
        <div class="meta-row">
          {#if !isGuest}
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
        <p class="profile-joined">
          <Calendar size={13} />
          {m.profile_member_since()}: {memberSince}
        </p>
      </div>
    </header>

    <section class="panel">
      <div class="profile-section-header profile-section-header--split">
        <div class="profile-section-title-wrap">
          <h2 class="card-title">
            {yearTotalSessions === 1
              ? m.profile_sessions_in_year_one({ year: String(selectedYear) })
              : m.profile_sessions_in_year({
                  count: String(yearTotalSessions),
                  year: String(selectedYear)
                })}
          </h2>
        </div>
        <div
          class="segmented profile-heatmap-year-picker"
          role="group"
          aria-label={m.profile_heatmap_year_aria()}
        >
          {#each availableYears as year (year)}
            <button
              type="button"
              class="segmented-item"
              aria-pressed={year === selectedYear}
              onclick={() => {
                selectedYear = year;
              }}
            >
              {year}
            </button>
          {/each}
        </div>
      </div>

      <p class="profile-heatmap-scroll-hint">{m.profile_heatmap_scroll_hint()}</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling for this region) -->
      <div
        class="profile-heatmap-scroll"
        bind:this={heatmapScrollEl}
        tabindex="0"
        role="region"
        aria-label={m.profile_heatmap_scroll_hint()}
      >
        <div
          class="profile-heatmap-shell"
          style={`--week-count:${heatmapWeekCount}`}
          role="img"
          aria-label={m.profile_heatmap_image_aria({ year: String(selectedYear) })}
        >
          <div class="profile-heatmap-months" aria-hidden="true">
            <div class="profile-heatmap-months-spacer"></div>
            <div class="profile-heatmap-months-grid">
              {#each heatmapWeeks as week, i (week.startMs)}
                <span class="profile-heatmap-month" style={`grid-column:${i + 1}`}
                  >{week.monthLabel}</span
                >
              {/each}
            </div>
          </div>

          <div class="profile-heatmap-main">
            <div class="profile-heatmap-weekdays" aria-hidden="true">
              {#each weekdayLabels as label, idx (`${idx}-${label}`)}
                <span>{label}</span>
              {/each}
            </div>

            <div class="profile-heatmap-grid">
              {#each heatmapWeeks as week (week.startMs)}
                <div
                  class={`profile-heatmap-week ${
                    selectedYear === CURRENT_YEAR &&
                    week.startMs <= todayDayMs &&
                    todayDayMs < week.startMs + 7 * DAY_MS
                      ? 'is-current-week'
                      : ''
                  }`}
                >
                  {#each week.cells as cell (cell.dateKey)}
                    <span
                      class={`profile-heatmap-cell level-${cell.level} ${cell.inFuture ? 'is-future' : ''} ${cell.beforeAccount ? 'is-before-account' : ''} ${cell.outsideYear ? 'is-outside-year' : ''} ${
                        selectedYear === CURRENT_YEAR && cell.dateMs === todayDayMs
                          ? 'is-today'
                          : ''
                      }`}
                      title={cell.outsideYear
                        ? m.profile_heatmap_outside_year({ year: String(selectedYear) })
                        : cell.beforeAccount
                          ? m.profile_heatmap_before_account({
                              date: DAY_FORMATTER.format(cell.dateMs)
                            })
                          : cell.count === 1
                            ? m.profile_heatmap_day_one({
                                date: DAY_FORMATTER.format(cell.dateMs)
                              })
                            : m.profile_heatmap_day_many({
                                count: String(cell.count),
                                date: DAY_FORMATTER.format(cell.dateMs)
                              })}
                    ></span>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <div class="profile-heatmap-legend" aria-hidden="true">
        <span>{m.profile_heatmap_less()}</span>
        <span class="profile-heatmap-cell level-0"></span>
        <span class="profile-heatmap-cell level-1"></span>
        <span class="profile-heatmap-cell level-2"></span>
        <span class="profile-heatmap-cell level-3"></span>
        <span class="profile-heatmap-cell level-4"></span>
        <span>{m.profile_heatmap_more()}</span>
      </div>
    </section>

    <!-- CW settings snapshot: peer readouts in an inset stat strip. -->
    <section class="panel">
      <h2 class="card-title">{m.profile_cw_settings()}</h2>
      <div class="profile-cw-grid">
        <div class="profile-stat">
          <span class="metric-value">{charWpm}</span>
          <span class="metric-label">{m.profile_cw_char_wpm()}</span>
        </div>
        <div class="profile-stat">
          <span class="metric-value">{effWpm}</span>
          <span class="metric-label">{m.profile_cw_eff_wpm()}</span>
        </div>
        <div class="profile-stat">
          <span class="metric-value">{freq} Hz</span>
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
                <th class="panel-label">{m.profile_history_accuracy()}</th>
                <th class="panel-label">{m.profile_history_wpm()}</th>
                <th class="panel-label">{m.profile_history_date()}</th>
              </tr>
            </thead>
            <tbody>
              {#each recentRecords as rec, idx (`${rec.created_at}-${rec.lesson}-${idx}`)}
                <tr>
                  <td class="profile-lesson-cell">{formatLesson(rec.lesson)}</td>
                  <td
                    ><span class="profile-acc {accuracyClass(rec.accuracy)}"
                      >{percentage(rec.accuracy)}</span
                    ></td
                  >
                  <td class="profile-wpm-cell">{rec.char_wpm} / {rec.eff_wpm}</td>
                  <td class="profile-date-cell">{formatDate(rec.created_at)}</td>
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

  /* Activity heatmap */
  .profile-section-header--split {
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .profile-section-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1 1 auto;
    min-width: 0;
  }
  .profile-heatmap-scroll {
    overflow-x: auto;
    padding-right: 0.15rem;
    scrollbar-gutter: stable both-edges;
  }
  .profile-heatmap-scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .profile-heatmap-scroll-hint {
    display: none;
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .profile-heatmap-shell {
    width: max-content;
  }
  .profile-heatmap-months {
    display: grid;
    grid-template-columns: 2.2rem max-content;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .profile-heatmap-months-spacer {
    width: 2.2rem;
  }
  .profile-heatmap-months-grid {
    display: grid;
    grid-template-columns: repeat(var(--week-count), 0.72rem);
    column-gap: 0.22rem;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1;
  }
  .profile-heatmap-month {
    white-space: nowrap;
  }
  .profile-heatmap-main {
    display: grid;
    grid-template-columns: 2.2rem max-content;
    gap: 0.4rem;
  }
  .profile-heatmap-weekdays {
    display: grid;
    grid-template-rows: repeat(7, 0.72rem);
    row-gap: 0.22rem;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1;
    align-items: center;
  }
  .profile-heatmap-grid {
    display: grid;
    grid-template-columns: repeat(var(--week-count), 0.72rem);
    column-gap: 0.22rem;
  }
  .profile-heatmap-week {
    display: grid;
    grid-template-rows: repeat(7, 0.72rem);
    row-gap: 0.22rem;
  }
  .profile-heatmap-cell {
    width: 0.72rem;
    height: 0.72rem;
    border-radius: var(--radius-xs);
    border: 1px solid color-mix(in srgb, var(--border), transparent 45%);
    background: var(--bg-inset);
    display: inline-block;
  }
  /* Level ramp derived from the accent so it matches the brand in both themes
     (the raw GitHub greens were dark-only and clashed on a white surface). */
  .profile-heatmap-cell.level-1,
  .profile-heatmap-cell.level-2,
  .profile-heatmap-cell.level-3,
  .profile-heatmap-cell.level-4 {
    border-color: transparent;
  }
  .profile-heatmap-cell.level-1 {
    background: color-mix(in srgb, var(--accent-cta) 22%, var(--bg-inset));
  }
  .profile-heatmap-cell.level-2 {
    background: color-mix(in srgb, var(--accent-cta) 45%, var(--bg-inset));
  }
  .profile-heatmap-cell.level-3 {
    background: color-mix(in srgb, var(--accent-cta) 70%, var(--bg-inset));
  }
  .profile-heatmap-cell.level-4 {
    background: var(--accent-cta);
  }
  .profile-heatmap-cell.is-future {
    opacity: 0.45;
  }
  .profile-heatmap-cell.is-outside-year {
    opacity: 0.2;
    border-style: dashed;
    border-color: color-mix(in srgb, var(--border), transparent 65%);
  }
  .profile-heatmap-cell.is-before-account {
    opacity: 0.32;
    border-color: color-mix(in srgb, var(--border), transparent 55%);
  }
  .profile-heatmap-legend {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.35rem;
    margin-top: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* Section headers (heatmap, history) */
  .profile-section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    color: var(--text-muted);
  }
  .profile-section-header :global(.card-title) {
    width: 100%;
    margin-bottom: 0;
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

  @media (max-width: 900px) {
    .profile-heatmap-scroll-hint {
      display: block;
    }
  }
</style>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { HistorySessionRecord } from '#lib/training/v2/types.ts';
  import {
    DAY_MS,
    type HeatmapCell,
    buildHeatmap,
    countSessionsForYear,
    getAvailableYears,
    progressRecordDays,
    utcDayStart
  } from '#lib/profile-heatmap.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    records: HistorySessionRecord[];
    memberCreatedAtMs: number | null;
    earliestHistoryMs: number | null;
  }

  let { records, memberCreatedAtMs, earliestHistoryMs }: Props = $props();

  const CURRENT_YEAR = new Date().getUTCFullYear();
  let selectedYear = $state(CURRENT_YEAR);
  let heatmapScrollEl = $state<HTMLDivElement | null>(null);
  let activeDateMs = $state<number | null>(null);
  let tooltipCell = $state<HeatmapCell | null>(null);
  let tooltipPanel = $state<HTMLSpanElement>();
  let tooltipLeft = $state(0);
  let tooltipTop = $state(0);
  const tooltipId = $props.id();
  let tooltipAnchor: HTMLButtonElement | null = null;
  let focusedDateMs: number | null = null;
  let pinned = false;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;

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
  const MONTH_FORMATTER = $derived(
    new Intl.DateTimeFormat(getLocale(), { month: 'short', timeZone: 'UTC' })
  );
  const DAY_FORMATTER = $derived(
    new Intl.DateTimeFormat(getLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    })
  );

  let activityRangeStart = $derived(
    memberCreatedAtMs === null
      ? earliestHistoryMs
      : earliestHistoryMs === null
        ? memberCreatedAtMs
        : Math.min(memberCreatedAtMs, earliestHistoryMs)
  );
  let availableYears = $derived(getAvailableYears(activityRangeStart, CURRENT_YEAR));
  const dailyCounts = $derived(progressRecordDays(records));
  let yearTotalSessions = $derived(countSessionsForYear(dailyCounts, selectedYear));
  let heatmapWeeks = $derived(
    buildHeatmap(dailyCounts, activityRangeStart, selectedYear, {
      todayMs: Date.now(),
      formatMonth: (ms) => MONTH_FORMATTER.format(ms)
    })
  );
  let heatmapWeekCount = $derived(Math.max(1, heatmapWeeks.length));
  let todayDayMs = $derived(utcDayStart(Date.now()));

  let selectableDays = $derived(heatmapWeeks.flatMap((week) => week.cells).filter(isSelectable));
  let tabDateMs = $derived(
    selectableDays.some((cell) => cell.dateMs === activeDateMs)
      ? activeDateMs
      : selectedYear === CURRENT_YEAR
        ? selectableDays.at(-1)?.dateMs
        : selectableDays[0]?.dateMs
  );

  function isSelectable(cell: HeatmapCell): boolean {
    return !cell.outsideYear && !cell.beforeAccount && !cell.inFuture;
  }

  function dayDescription(cell: HeatmapCell): string {
    const date = DAY_FORMATTER.format(cell.dateMs);
    return cell.count === 1
      ? m.profile_heatmap_day_one({ date })
      : m.profile_heatmap_day_many({ count: String(cell.count), date });
  }

  function closeTooltip() {
    clearTimeout(leaveTimer);
    tooltipCell = null;
    pinned = false;
  }

  function showTooltip(cell: HeatmapCell, button: HTMLButtonElement) {
    clearTimeout(leaveTimer);
    if (tooltipCell?.dateMs !== cell.dateMs) pinned = false;
    tooltipAnchor = button;
    tooltipCell = cell;
  }

  function leaveTooltip() {
    if (pinned || focusedDateMs === tooltipCell?.dateMs) return;
    leaveTimer = setTimeout(closeTooltip, 150);
  }

  function positionTooltip() {
    if (!tooltipCell || !tooltipPanel || !tooltipAnchor) return;
    const anchor = tooltipAnchor.getBoundingClientRect();
    if (
      anchor.bottom <= 0 ||
      anchor.top >= window.innerHeight ||
      anchor.right <= 0 ||
      anchor.left >= window.innerWidth
    )
      return closeTooltip();
    const bounds = tooltipPanel.getBoundingClientRect();
    tooltipLeft = Math.max(16, Math.min(anchor.left, window.innerWidth - bounds.width - 16));
    tooltipTop =
      anchor.bottom + bounds.height + 4 <= window.innerHeight - 16
        ? anchor.bottom + 4
        : Math.max(16, anchor.top - bounds.height - 4);
  }

  function navigateDay(event: KeyboardEvent, cell: HeatmapCell) {
    const offsets: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7
    };
    const index = selectableDays.findIndex((day) => day.dateMs === cell.dateMs);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? selectableDays.length - 1
          : offsets[event.key] === undefined
            ? null
            : Math.max(0, Math.min(selectableDays.length - 1, index + offsets[event.key]));
    if (nextIndex === null) return;
    event.preventDefault();
    activeDateMs = selectableDays[nextIndex].dateMs;
    const button = heatmapScrollEl?.querySelector<HTMLButtonElement>(
      `button[data-date="${activeDateMs}"]`
    );
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  $effect(() => {
    if (tooltipCell) void tick().then(positionTooltip);
  });

  onMount(() => {
    document.addEventListener('scroll', positionTooltip, true);
    return () => {
      document.removeEventListener('scroll', positionTooltip, true);
      clearTimeout(leaveTimer);
    };
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

  /** Keep "now" in view for the current year; past years start at January. */
  function scrollHeatmapForYear(): void {
    requestAnimationFrame(() => {
      if (!heatmapScrollEl) return;
      if (selectedYear === CURRENT_YEAR) {
        scrollHeatmapToCurrentWeek();
      } else {
        heatmapScrollEl.scrollLeft = 0;
      }
    });
  }

  $effect(() => {
    if (!availableYears.includes(selectedYear)) {
      selectedYear = availableYears[0] ?? new Date().getUTCFullYear();
    }
  });

  $effect(() => {
    if (heatmapWeeks.length === 0 || !heatmapScrollEl) return;
    scrollHeatmapForYear();
  });
</script>

<svelte:window onresize={closeTooltip} />
<svelte:document
  onkeydown={(event) => {
    if (event.key === 'Escape') closeTooltip();
  }}
  onpointerdown={(event) => {
    if (
      event.target instanceof Node &&
      !tooltipAnchor?.contains(event.target) &&
      !tooltipPanel?.contains(event.target)
    )
      closeTooltip();
  }}
/>

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
            closeTooltip();
            activeDateMs = null;
            selectedYear = year;
          }}
        >
          {year}
        </button>
      {/each}
    </div>
  </div>

  <p class="profile-heatmap-scroll-hint">{m.profile_heatmap_scroll_hint()}</p>
  <div
    class="profile-heatmap-scroll"
    bind:this={heatmapScrollEl}
    role="region"
    aria-label={m.profile_heatmap_scroll_hint()}
  >
    <div
      class="profile-heatmap-shell"
      style={`--week-count:${heatmapWeekCount}`}
      role="group"
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
                {#if isSelectable(cell)}
                  <button
                    type="button"
                    class={`profile-heatmap-cell level-${cell.level} ${selectedYear === CURRENT_YEAR && cell.dateMs === todayDayMs ? 'is-today' : ''}`}
                    data-date={cell.dateMs}
                    tabindex={cell.dateMs === tabDateMs ? 0 : -1}
                    aria-label={dayDescription(cell)}
                    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
                    aria-describedby={tooltipCell?.dateMs === cell.dateMs ? tooltipId : undefined}
                    aria-expanded={tooltipCell?.dateMs === cell.dateMs}
                    onpointerenter={(event) => {
                      if (event.pointerType !== 'touch') showTooltip(cell, event.currentTarget);
                    }}
                    onpointerleave={(event) => {
                      if (event.pointerType !== 'touch') leaveTooltip();
                    }}
                    onfocus={(event) => {
                      activeDateMs = cell.dateMs;
                      focusedDateMs = cell.dateMs;
                      showTooltip(cell, event.currentTarget);
                    }}
                    onblur={() => {
                      focusedDateMs = null;
                      if (!pinned) closeTooltip();
                    }}
                    onclick={(event) => {
                      if (pinned && tooltipCell?.dateMs === cell.dateMs) closeTooltip();
                      else {
                        showTooltip(cell, event.currentTarget);
                        pinned = true;
                      }
                    }}
                    onkeydown={(event) => {
                      if (event.key === 'Tab') closeTooltip();
                      else navigateDay(event, cell);
                    }}
                  ></button>
                {:else}
                  <span
                    class={`profile-heatmap-cell level-0 ${cell.inFuture ? 'is-future' : ''} ${cell.beforeAccount ? 'is-before-account' : ''} ${cell.outsideYear ? 'is-outside-year' : ''}`}
                    aria-hidden="true"
                    title={cell.outsideYear
                      ? m.profile_heatmap_outside_year({ year: String(selectedYear) })
                      : cell.beforeAccount
                        ? m.profile_heatmap_before_account({
                            date: DAY_FORMATTER.format(cell.dateMs)
                          })
                        : DAY_FORMATTER.format(cell.dateMs)}
                  ></span>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  {#if tooltipCell}
    <span
      id={tooltipId}
      role="tooltip"
      class="profile-heatmap-tooltip"
      bind:this={tooltipPanel}
      style:left={`${tooltipLeft}px`}
      style:top={`${tooltipTop}px`}
      onpointerenter={() => clearTimeout(leaveTimer)}
      onpointerleave={leaveTooltip}>{dayDescription(tooltipCell)}</span
    >
  {/if}

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

<style>
  .panel {
    --heatmap-cell-size: 1.25rem;
    --heatmap-gap: 0.25rem;
  }
  button.profile-heatmap-cell {
    padding: 0;
    cursor: pointer;
  }
  button.profile-heatmap-cell:hover,
  button.profile-heatmap-cell[aria-expanded='true'] {
    border-color: var(--accent);
  }
  button.profile-heatmap-cell:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    position: relative;
    z-index: 1;
  }
  .profile-heatmap-tooltip {
    position: fixed;
    z-index: 100;
    width: max-content;
    max-width: calc(100vw - 2 * var(--space-4));
    box-sizing: border-box;
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-secondary);
    box-shadow: var(--shadow-menu);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

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
    grid-template-columns: repeat(var(--week-count), var(--heatmap-cell-size));
    column-gap: var(--heatmap-gap);
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
    grid-template-rows: repeat(7, var(--heatmap-cell-size));
    row-gap: var(--heatmap-gap);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1;
    align-items: center;
  }
  .profile-heatmap-grid {
    display: grid;
    grid-template-columns: repeat(var(--week-count), var(--heatmap-cell-size));
    column-gap: var(--heatmap-gap);
  }
  .profile-heatmap-week {
    display: grid;
    grid-template-rows: repeat(7, var(--heatmap-cell-size));
    row-gap: var(--heatmap-gap);
  }
  .profile-heatmap-cell {
    width: var(--heatmap-cell-size);
    height: var(--heatmap-cell-size);
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
  .profile-heatmap-legend .profile-heatmap-cell {
    width: 0.72rem;
    height: 0.72rem;
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

  @media (max-width: 900px) {
    .profile-heatmap-scroll-hint {
      display: block;
    }
  }
</style>

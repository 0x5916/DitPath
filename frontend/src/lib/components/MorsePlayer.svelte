<script lang="ts">
  import { calculateDuration, buildAudioPlan } from '$lib/training/timing';
  import type { AudioPlan } from '$lib/training/timing';
  import { createWebAudioEngine } from '$lib/audio/engine';
  import type { AudioEngine } from '$lib/audio/engine';
  import { formatClock } from '$lib/format';
  import { onDestroy, untrack } from 'svelte';
  import { Play, Square, Pause, SlidersHorizontal, SkipForward } from '@lucide/svelte';
  import { user } from '$lib/auth';
  import GuestNotice from '$lib/components/GuestNotice.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    text?: string;
    charWpm?: number;
    effWpm?: number;
    freq?: number;
    startDelay?: number;
    volume?: number;
    playLabel?: string;
    label?: string;
    showSettings?: boolean;
    /* 'primary' keeps the play control amber; 'quiet' dresses it as a secondary
       action once the passage has already been played through once. */
    playTone?: 'primary' | 'quiet';
    /* Stop, skip and the clock stay hidden until playback has started, so the
       ready state shows one obvious action instead of dead controls. */
    showTransportExtras?: boolean;
    onSettingsInput?: () => void;
    /* Fired whenever playback starts, whichever control started it. The page
       uses it to unlock the answer box or mask the drill character. */
    onStart?: () => void;
    onEnded?: () => void;
    /* Test seam: replace the browser engine (e.g. with a fake) without
       touching the transport UI. */
    createEngine?: () => AudioEngine;
  }

  let {
    text = '',
    charWpm = $bindable(20),
    effWpm = $bindable(12),
    freq = $bindable(600),
    startDelay = 0,
    volume = 1.0,
    playLabel = '',
    label = '',
    showSettings = false,
    playTone = 'primary',
    showTransportExtras = true,
    onSettingsInput = () => {},
    onStart = () => {},
    onEnded = () => {},
    createEngine = (): AudioEngine => createWebAudioEngine()
  }: Props = $props();

  let effectivePlayLabel = $derived(playLabel || m.player_play());

  /* Playback is delegated to an audio engine; this component keeps only the
     transport/UI view of it. `activePlan` is the exact schedule the engine is
     playing, so the clock and the playhead always match the audio. The engine
     is created once for the component's lifetime. */
  const engine = untrack(() => createEngine());
  let started = $state(false);
  let paused = $state(false);
  let progress = $state(0);
  let timer = $state(0);
  let rafId = 0;
  let activeText = $state('');
  let activePlan = $state<AudioPlan | null>(null);
  let settingsOpen = $state(false);
  let settingsEl = $state<HTMLDetailsElement | null>(null);
  let settingsPanelEl = $state<HTMLDivElement | null>(null);
  /* Phones only: script placement for the viewport-anchored popover. Kept null on
     desktop, where the stylesheet's absolute popover under the trigger applies. */
  let settingsPlacement = $state<{
    top: string;
    left: string;
    width: string | null;
    maxHeight: string;
  } | null>(null);
  let safeProbeEl = $state<HTMLDivElement | null>(null);

  /** A design-token length in pixels, so placement stays on the spacing scale. */
  function tokenPx(name: string, fallbackRem: number): number {
    const root = getComputedStyle(document.documentElement);
    const raw = root.getPropertyValue(name).trim();
    const value = Number.parseFloat(raw);
    const rem = Number.parseFloat(root.fontSize) || 16;
    if (!Number.isFinite(value)) return fallbackRem * rem;
    return raw.endsWith('rem') ? value * rem : value;
  }

  /** Safe-area insets in pixels, read from the hidden probe in the markup. */
  function safeAreaInsets() {
    if (!safeProbeEl) return { top: 0, right: 0, bottom: 0, left: 0 };
    const style = getComputedStyle(safeProbeEl);
    const inset = (value: string) => {
      const px = Number.parseFloat(value);
      return Number.isFinite(px) ? px : 0;
    };
    return {
      top: inset(style.paddingTop),
      right: inset(style.paddingRight),
      bottom: inset(style.paddingBottom),
      left: inset(style.paddingLeft)
    };
  }

  /**
   * Places the settings popover on whichever side of its trigger has the most
   * usable room, at every screen size. Left, right, above and below are each
   * measured against the safe viewport band (visual viewport minus the page
   * chrome, the safe-area insets and a breathing edge); the side that can show
   * the whole panel at a workable width wins, and when no side can, the largest
   * one wins and only the panel's inner content scrolls. Horizontal sides spread
   * toward the free edge, vertical sides keep the popover's narrow width.
   */
  function placeSettingsPanel() {
    const panel = settingsPanelEl;
    const trigger = settingsEl?.querySelector<HTMLElement>('summary') ?? null;
    if (!panel || !trigger) return;

    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const viewport = window.visualViewport;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
    const viewLeft = viewport?.offsetLeft ?? 0;
    const viewRight = viewLeft + (viewport?.width ?? window.innerWidth);

    // Page chrome sits over the viewport: the sticky top bar (desktop; phones
    // hide it) and the fixed tab bar (phones; desktop hides it). Each includes
    // its own safe-area padding, so it covers that inset while the opposite edge
    // still needs it. The tab bar also slides away while the keyboard is open.
    const chromeHeight = (selector: string) => {
      const el = document.querySelector(selector);
      return el instanceof HTMLElement && getComputedStyle(el).display !== 'none'
        ? el.getBoundingClientRect().height
        : 0;
    };
    const topBarHeight = chromeHeight('.navbar');
    const navHeight = document.body.classList.contains('keyboard-open')
      ? 0
      : chromeHeight('.bottom-nav');

    // The safe viewport band: visual viewport minus that chrome, the device
    // safe-area insets and a breathing edge. Every placement is clamped into it,
    // so the panel stays on screen even when its trigger has been scrolled away.
    const safe = safeAreaInsets();
    const margin = tokenPx('--space-4', 1);
    const topEdge = topBarHeight > 0 ? topBarHeight + margin : Math.max(margin, safe.top);
    const bottomEdge = navHeight > 0 ? navHeight + margin : Math.max(margin, safe.bottom);
    const usableLeft = viewLeft + Math.max(margin, safe.left);
    const usableRight = viewRight - Math.max(margin, safe.right);
    const usableTop = viewTop + topEdge;
    const usableBottom = viewBottom - bottomEdge;
    const bandWidth = Math.max(usableRight - usableLeft, 0);
    const bandHeight = Math.max(usableBottom - usableTop, 0);

    const panelStyle = getComputedStyle(panel);
    const panelPx = (name: string, fallbackRem: number) => {
      const raw = panelStyle.getPropertyValue(name).trim();
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) return fallbackRem * rem;
      return raw.endsWith('rem') ? value * rem : value;
    };

    const gap = tokenPx('--space-2', 0.5);
    const narrowWidth = Math.min(panelPx('--panel-narrow-width', 14), bandWidth);
    const wideWidth = Math.min(panelPx('--panel-wide-width', 20), bandWidth);
    const triggerRect = trigger.getBoundingClientRect();
    const contentHeight = panel.scrollHeight;

    // Room each side can offer the panel itself, between it and the safe edges.
    const room = {
      left: Math.max(triggerRect.left - gap - usableLeft, 0),
      right: Math.max(usableRight - triggerRect.right - gap, 0),
      above: Math.max(triggerRect.top - gap - usableTop, 0),
      below: Math.max(usableBottom - triggerRect.bottom - gap, 0)
    };

    // Horizontal placements spread toward the free edge up to the wide ceiling;
    // vertical ones keep the narrow popover width. Every side is capped by the
    // band itself, so a trigger scrolled out of view cannot inflate the room.
    const widthOf = (side: keyof typeof room) =>
      side === 'left' || side === 'right' ? Math.min(room[side], wideWidth) : narrowWidth;
    const heightOf = (side: keyof typeof room) =>
      side === 'left' || side === 'right'
        ? Math.min(contentHeight, bandHeight)
        : Math.min(contentHeight, room[side], bandHeight);

    const sides = ['left', 'below', 'above', 'right'] as const;
    const wholePanel = (side: (typeof sides)[number]) =>
      widthOf(side) >= narrowWidth && heightOf(side) >= contentHeight;
    const fitting = sides.filter(wholePanel);
    const pool = fitting.length > 0 ? fitting : sides;

    // Largest usable area wins; the order above breaks ties, so this
    // right-aligned trigger opens to its left whenever that side has the room.
    let side: (typeof sides)[number] = pool[0];
    let area = 0;
    for (const candidate of pool) {
      const candidateArea = widthOf(candidate) * heightOf(candidate);
      if (candidateArea > area) {
        area = candidateArea;
        side = candidate;
      }
    }

    const width = Math.round(widthOf(side));
    const height = Math.round(heightOf(side));
    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), Math.max(min, max));

    // Horizontal: line the panel up with the trigger, then clamp it into the
    // band. Vertical: sit above or below the trigger and clamp the same way.
    const top =
      side === 'left' || side === 'right'
        ? clamp(triggerRect.top, usableTop, usableBottom - height)
        : clamp(
            side === 'above' ? triggerRect.top - gap - height : triggerRect.bottom + gap,
            usableTop,
            usableBottom - height
          );
    const left =
      side === 'left'
        ? clamp(triggerRect.left - gap - width, usableLeft, usableRight - width)
        : side === 'right'
          ? clamp(triggerRect.right + gap, usableLeft, usableRight - width)
          : clamp(triggerRect.right - width, usableLeft, usableRight - width);

    settingsPlacement = {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: side === 'left' || side === 'right' ? `${width}px` : null,
      maxHeight: contentHeight <= height ? 'none' : `${Math.floor(height)}px`
    };
  }

  // Re-place the popover every time it opens, and keep it anchored while the
  // viewport, the keyboard or the page moves under it. The listeners live for the
  // component's lifetime, so a close/re-open cycle cannot drop them.
  let settingsFrame = 0;

  $effect(() => {
    const place = () => {
      if (!settingsOpen) return;
      placeSettingsPanel();
    };
    // Scroll fires often: batch it to one placement per frame. Resize and
    // keyboard changes are rare and must never be missed, so they place
    // straight away (frame callbacks are throttled in background tabs).
    const schedule = () => {
      if (!settingsOpen) return;
      cancelAnimationFrame(settingsFrame);
      settingsFrame = requestAnimationFrame(placeSettingsPanel);
    };
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(settingsFrame);
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  });

  $effect(() => {
    if (!settingsOpen) {
      settingsPlacement = null;
      return;
    }
    placeSettingsPanel();
  });

  // Native <details> ignores outside clicks; close the settings panel the way
  // the app's menus close, and send Escape back to the trigger.
  $effect(() => {
    if (!settingsOpen) return;
    function onDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (settingsEl && target instanceof Node && !settingsEl.contains(target)) {
        settingsOpen = false;
      }
    }
    function onDocumentKeydown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      settingsOpen = false;
      settingsEl?.querySelector('summary')?.focus();
    }
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeydown);
    };
  });

  /* The transport clock quotes the active playback exactly; while idle it
     previews the text at the current settings. */
  let duration = $derived(
    started && activePlan
      ? activePlan.totalDuration + activePlan.startDelay
      : calculateDuration(activeText, charWpm, effWpm) + startDelay
  );
  let elapsedTime = $derived(Math.max(timer, 0));
  let totalTime = $derived(Math.max(duration - startDelay, 0));

  $effect(() => {
    if (!started) activeText = text;
  });

  /** Reset the local transport view; the engine has already released its audio. */
  function resetTransport() {
    cancelAnimationFrame(rafId);
    started = false;
    paused = false;
    progress = 0;
    timer = 0;
    activePlan = null;
  }

  function tick() {
    if (!started) return;
    const plan = activePlan;
    const elapsed = engine.elapsed();
    if (plan && elapsed > 0) {
      timer = elapsed - plan.startDelay;
      const total = plan.totalDuration + plan.startDelay;
      progress = total > 0 ? Math.min(elapsed / total, 1) : 1;
    }
    rafId = requestAnimationFrame(tick);
  }

  function startPlayback(sourceText: string) {
    const plan = buildAudioPlan(sourceText, {
      charWpm,
      effWpm,
      frequency: freq,
      volume,
      startDelay
    });
    activeText = sourceText;
    activePlan = plan;
    started = true;
    paused = false;
    timer = 0;
    progress = 0;
    engine.play(plan);
    onStart();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  /* The engine owns the playback lifecycle; this subscription only mirrors it
     into component state and tells the page when playback is over. */
  const unsubscribeEnded = engine.subscribe((event) => {
    if (event !== 'ended') return;
    resetTransport();
    onEnded();
  });

  async function togglePlayPause() {
    if (!started) {
      startPlayback(activeText);
      return;
    }
    if (paused) {
      await engine.resume();
      paused = false;
    } else {
      await engine.pause();
      paused = true;
    }
  }

  /**
   * Stop playback. A notified stop lets the engine's ended event drive the
   * reset; a silent one (used when immediately replaying) resets locally.
   */
  async function stop(emitEnded = true) {
    const wasActive = engine.isActive();
    await engine.stop({ notify: emitEnded && wasActive });
    if (!emitEnded || !wasActive) {
      resetTransport();
      if (emitEnded) onEnded();
    }
  }

  async function skipNext() {
    if (!started) return;

    const source = activeText.toUpperCase();
    if (!source) return;

    const total = activePlan?.totalDuration ?? 0;
    const ratio = total > 0 ? elapsedTime / total : 1;
    const nextIndex = Math.min(source.length, Math.floor(ratio * source.length) + 1);
    const remaining = source.slice(nextIndex);

    if (!remaining) {
      // Nothing left to skip to: end the playback properly so the page's
      // transport state does not keep thinking a transmission is running.
      await stop(true);
      activeText = text;
      return;
    }

    await stop(false);
    startPlayback(remaining);
  }

  export async function playNow() {
    if (!text) return;
    startPlayback(text);
  }

  export async function stopNow() {
    await stop(true);
  }

  export function isStarted() {
    return started;
  }

  onDestroy(() => {
    // `onDestroy` also runs during SSR teardown, where there is no rAF API.
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    unsubscribeEnded();
    void engine.dispose();
  });
</script>

<div class="player-wrapper">
  <!-- Safe-area probe: the placement script reads env(safe-area-inset-*) here. -->
  <div class="safe-area-probe" aria-hidden="true" bind:this={safeProbeEl}></div>
  {#if label}
    <div class="player-header">
      <p class="card-title player-label">{label}</p>
    </div>
  {/if}
  <!-- Playhead: the timing line that runs while the transmission plays. -->
  <div
    class="player-playhead"
    role="progressbar"
    aria-valuenow={Math.round(progress * 100)}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={m.player_progress()}
  >
    <div class="player-playhead-fill" style="width: {started ? progress * 100 : 0}%"></div>
  </div>
  <div class="player-top">
    <div class="player-buttons">
      <div class="player-media-controls">
        {#if showTransportExtras}
          <button
            type="button"
            class="btn-icon"
            onclick={() => stop()}
            aria-label={m.player_stop()}
            title={m.player_stop()}
          >
            <Square size={16} />
          </button>
        {/if}
        <button
          type="button"
          class={started && !paused
            ? 'btn-primary player-play-btn'
            : playTone === 'quiet'
              ? 'btn-ghost player-play-btn'
              : 'btn-primary player-play-btn'}
          onclick={togglePlayPause}
          aria-label={started && !paused ? m.player_pause() : effectivePlayLabel}
        >
          {#if started && !paused}
            <Pause size={16} />
            {m.player_pause()}
          {:else}
            <Play size={16} />
            {effectivePlayLabel}
          {/if}
        </button>
        {#if showTransportExtras}
          <button
            type="button"
            class="btn-icon"
            onclick={skipNext}
            aria-label={m.player_skip_next()}
            title={m.player_skip_next()}
          >
            <SkipForward size={16} />
          </button>
          <span class="player-inline-timer" class:player-timer-delay={timer < 0 && started}>
            {formatClock(elapsedTime)} / {formatClock(totalTime)}
          </span>
        {/if}
      </div>
      {#if showSettings}
        <details class="player-settings-menu" bind:this={settingsEl} bind:open={settingsOpen}>
          <summary
            class="player-settings-trigger"
            aria-label={m.trainer_label_settings()}
            title={m.trainer_label_settings()}
          >
            <SlidersHorizontal size={14} />
          </summary>
          <div
            class="player-settings-popover card-sm"
            bind:this={settingsPanelEl}
            style:top={settingsPlacement?.top}
            style:left={settingsPlacement?.left}
            style:width={settingsPlacement?.width}
            style:max-height={settingsPlacement?.maxHeight}
          >
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_char_wpm()}</span>
              <input
                type="number"
                bind:value={charWpm}
                min="5"
                max="50"
                class="input"
                oninput={() => onSettingsInput()}
              />
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_eff_wpm()}</span>
              <input
                type="number"
                bind:value={effWpm}
                min="5"
                max="50"
                class="input"
                oninput={() => onSettingsInput()}
              />
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_freq()}</span>
              <input
                type="number"
                bind:value={freq}
                min="300"
                max="2000"
                class="input"
                oninput={() => onSettingsInput()}
              />
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.player_volume()}</span>
              <div class="player-volume-row">
                <input
                  type="range"
                  bind:value={volume}
                  min="0"
                  max="1"
                  step="0.05"
                  class="player-volume-slider"
                  oninput={() => onSettingsInput()}
                />
                <span class="player-volume-value">{Math.round(volume * 100)}%</span>
              </div>
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_start_delay()}</span>
              <input
                type="number"
                bind:value={startDelay}
                min="0"
                max="10"
                step="0.5"
                class="input"
                oninput={() => onSettingsInput()}
              />
            </label>
            {#if !$user}
              <div class="player-settings-auth-hint">
                <GuestNotice />
              </div>
            {/if}
          </div>
        </details>
      {/if}
    </div>
  </div>
</div>

<style>
  .player-wrapper {
    --player-control-height: 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Reads env(safe-area-inset-*) for the placement script; out of flow and
     zero-sized, so it never affects the layout. */
  .safe-area-probe {
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    visibility: hidden;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
      env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }

  .player-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }

  /* No rule: the card's own header rule sits at the top of this group, so a
     second hairline here would only mark a sub-group. `.card-title` would draw
     one under just the label's text width, so it is suppressed. */
  .player-label {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .player-top {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .player-timer-delay {
    color: var(--text-muted);
  }

  /* Timing line: the 2px hairline the playhead runs along. */
  .player-playhead {
    height: 2px;
    background: var(--border);
    overflow: hidden;
  }

  .player-playhead-fill {
    height: 100%;
    width: 0;
    background: var(--accent);
    transition: width 120ms linear;
  }

  .player-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: stretch;
    position: relative;
    min-width: 0;
  }

  .player-media-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    row-gap: 0.35rem;
    flex: 1 1 auto;
    min-width: 0;
  }

  .player-inline-timer {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--accent);
    white-space: nowrap;
    text-align: right;
    min-width: 0;
  }

  /* The one labelled control: play/pause is the button people look for. */
  .player-play-btn {
    flex: 0 0 auto;
    max-width: 100%;
    padding-inline: var(--space-4);
  }

  .player-settings-menu {
    margin-left: auto;
    display: flex;
  }

  .player-settings-trigger {
    list-style: none;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--player-control-height);
    height: var(--player-control-height);
    line-height: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      border-color var(--transition-fast),
      color var(--transition-fast),
      background-color var(--transition-fast);
  }

  .player-settings-trigger::-webkit-details-marker {
    display: none;
  }

  .player-settings-trigger:hover {
    border-color: var(--border-subtle);
    background: var(--bg-inset);
    color: var(--text-primary);
  }

  .player-settings-menu[open] .player-settings-trigger {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .player-settings-popover {
    /* Placement sizes the floating panel from these two lengths. */
    --panel-narrow-width: 14rem;
    --panel-wide-width: 20rem;
    /* Viewport-anchored at every size; placeSettingsPanel() sets top/left/width/
       max-height inline. z-index sits above the page and the sticky chrome but
       below the review modal. */
    position: fixed;
    top: auto;
    right: auto;
    z-index: 60;
    width: min(var(--panel-narrow-width), calc(100vw - 2rem));
    max-height: min(24rem, 70vh);
    overflow-y: auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    border-radius: var(--radius-md);
    /* Floating surface: this is where elevation is allowed. */
    box-shadow: var(--shadow-menu);
  }

  .player-settings-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .player-settings-auth-hint {
    margin: 0.1rem 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.45;
  }

  .player-volume-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
  }

  .player-volume-slider {
    width: 100%;
    accent-color: var(--accent);
  }

  .player-volume-value {
    font-size: var(--text-xs);
    color: var(--text-muted);
    min-width: 3ch;
    text-align: right;
  }

  @media (max-width: 900px) {
    .player-top {
      gap: 0.45rem;
    }
  }

  @media (max-width: 420px) {
    .player-buttons {
      flex-wrap: nowrap;
      overflow-x: visible;
    }

    .player-buttons > * {
      flex: 0 0 auto;
    }

    .player-media-controls {
      flex: 1 1 auto;
      min-width: 0;
      gap: 0.4rem;
    }

    .player-inline-timer {
      font-size: var(--text-xs);
      letter-spacing: -0.01em;
    }
  }
</style>

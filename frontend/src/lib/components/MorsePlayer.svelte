<script lang="ts">
  import { calculateDuration } from '#lib/training/timing.ts';
  import { createEvidenceAudioEngine } from '#lib/audio/evidence-engine.ts';
  import type { AudioEngine } from '#lib/audio/engine.ts';
  import { formatClock } from '#lib/format.ts';
  import { onDestroy, untrack } from 'svelte';
  import { Play, Square, Pause, SlidersHorizontal, SkipForward, CircleAlert } from '@lucide/svelte';
  import {
    createPlaybackController,
    idlePlayback,
    normalizePlaybackSettings,
    type PlaybackSettings
  } from '#lib/practice/playback.ts';
  import { user } from '#lib/auth.ts';
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import { computeSettingsPlacement, type SettingsPlacement } from './player-settings-placement';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    text?: string;
    charWpm?: number;
    effWpm?: number;
    freq?: number;
    startDelay?: number;
    volume?: number;
    playLabel?: string;
    /* Reserve the widest state label so changing the action does not move it. */
    reservePlayLabels?: string[];
    label?: string;
    showSettings?: boolean;
    /* 'primary' keeps the play control accented; 'quiet' dresses it as a secondary
       action once the passage has already been played through once. */
    playTone?: 'primary' | 'quiet';
    /* Stop, skip and the clock stay hidden until playback has started, so the
       ready state shows one obvious action instead of dead controls. */
    showTransportExtras?: boolean;
    onBeforeSettingsInput?: () => boolean | Promise<boolean>;
    onSettingsInput?: () => void;
    /* Fired whenever playback starts, whichever control started it. The page
       uses it to unlock the answer box or mask the drill character. */
    onStart?: () => void;
    onEnded?: () => void;
    onPausedChange?: (paused: boolean) => void;
    /* Test seam: replace the browser engine (e.g. with a fake) without
       touching the transport UI. */
    createEngine?: () => AudioEngine;
    exposureSource?: 'reference' | 'group';
  }

  let {
    text = '',
    charWpm = $bindable(20),
    effWpm = $bindable(12),
    freq = $bindable(600),
    startDelay = $bindable(0),
    volume = $bindable(1.0),
    playLabel = '',
    reservePlayLabels = [],
    label = '',
    showSettings = false,
    playTone = 'primary',
    showTransportExtras = true,
    onBeforeSettingsInput = () => true,
    onSettingsInput = () => {},
    onStart = () => {},
    onEnded = () => {},
    onPausedChange = () => {},
    exposureSource = 'reference',
    createEngine = (): AudioEngine => createEvidenceAudioEngine({ source: exposureSource })
  }: Props = $props();

  let reservedPlayLabels = $derived([...new Set(reservePlayLabels)]);

  /* Playback is delegated to an audio engine; this component keeps only the
     transport/UI view of it. `activePlan` is the exact schedule the engine is
     playing, so the clock and the playhead always match the audio. The engine
     is created once for the component's lifetime. */
  const engine = untrack(() => createEngine());
  let playback = $state.raw(idlePlayback());
  let effectivePlayLabel = $derived(
    playback.started && playback.paused ? m.player_resume() : playLabel || m.player_play()
  );

  let started = $derived(playback.started);
  let paused = $derived(playback.paused);
  let progress = $derived(playback.progress);
  let timer = $derived(playback.timer);
  let rafId = 0;
  let lastPaused = false;
  const transport = createPlaybackController({
    engine,
    getSettings: () => ({ charWpm, effWpm, freq, volume, startDelay }),
    onChange: (state) => {
      playback = state;
      if (state.paused !== lastPaused) {
        lastPaused = state.paused;
        onPausedChange(state.paused);
      }
    },
    onStart: (settings) => {
      applySettings(settings);
      onStart();
    },
    onEnded: () => onEnded()
  });
  let settingsOpen = $state(false);
  let playButton: HTMLButtonElement | null = null;
  let settingsDecisionPending = false;
  let disposed = false;
  let settingsEl = $state<HTMLDetailsElement | null>(null);
  let settingsPanelEl = $state<HTMLDivElement | null>(null);
  /* Phones only: script placement for the viewport-anchored popover. Kept null on
     desktop, where the stylesheet's absolute popover under the trigger applies. */
  let settingsPlacement = $state<SettingsPlacement | null>(null);
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

  /** Measure the viewport/chrome/trigger and let the pure helper place the panel. */
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

    const panelStyle = getComputedStyle(panel);
    const panelPx = (name: string, fallbackRem: number) => {
      const raw = panelStyle.getPropertyValue(name).trim();
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) return fallbackRem * rem;
      return raw.endsWith('rem') ? value * rem : value;
    };
    const triggerRect = trigger.getBoundingClientRect();

    settingsPlacement = computeSettingsPlacement({
      viewport: { top: viewTop, bottom: viewBottom, left: viewLeft, right: viewRight },
      trigger: {
        top: triggerRect.top,
        bottom: triggerRect.bottom,
        left: triggerRect.left,
        right: triggerRect.right
      },
      safe: safeAreaInsets(),
      chrome: { topBar: topBarHeight, nav: navHeight },
      margin: tokenPx('--space-4', 1),
      gap: tokenPx('--space-2', 0.5),
      narrowWidth: panelPx('--panel-narrow-width', 14),
      wideWidth: panelPx('--panel-wide-width', 20),
      contentHeight: panel.scrollHeight
    });
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
      if (settingsDecisionPending || (target instanceof Element && target.closest('dialog')))
        return;
      if (settingsEl && target instanceof Node && !settingsEl.contains(target)) {
        settingsOpen = false;
      }
    }
    function onDocumentKeydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.repeat || event.isComposing || event.keyCode === 229)
        return;
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
  let settings = $derived(normalizePlaybackSettings({ charWpm, effWpm, freq, volume, startDelay }));
  let elapsedTime = $derived(Math.max(timer, 0));
  let totalTime = $derived(
    playback.plan?.totalDuration ?? calculateDuration(text, settings.charWpm, settings.effWpm)
  );

  $effect(() => {
    const source = text;
    untrack(() => transport.replaceText(source));
  });

  $effect(() => {
    if (!started) return;
    const tick = () => {
      transport.update();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  function applySettings(next: PlaybackSettings) {
    ({ charWpm, effWpm, freq, volume, startDelay } = next);
  }

  async function commitSetting(key: keyof PlaybackSettings, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const next = normalizePlaybackSettings({ ...settings, [key]: input.valueAsNumber });
    input.value = String(settings[key]);
    if (disposed || settingsDecisionPending || next[key] === settings[key]) return;
    settingsDecisionPending = true;
    try {
      if (!(await onBeforeSettingsInput()) || disposed) return;
      applySettings(next);
      input.value = String(next[key]);
      onSettingsInput();
    } finally {
      settingsDecisionPending = false;
    }
  }

  export async function playNow() {
    transport.play(text);
  }

  export async function stopNow() {
    await transport.stop();
  }

  export function isStarted() {
    return started;
  }

  export function focusPlay() {
    playButton?.focus();
  }

  onDestroy(() => {
    disposed = true;
    // `onDestroy` also runs during SSR teardown, where there is no rAF API.
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    void transport.dispose();
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
            onclick={() => transport.stop()}
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
          onclick={() => transport.toggle(text)}
          {@attach (button) => {
            playButton = button;
            return () => {
              playButton = null;
            };
          }}
          disabled={playback.busy}
          aria-label={started && !paused ? m.player_pause() : effectivePlayLabel}
        >
          {#if started && !paused}
            <Pause size={16} />
          {:else}
            <Play size={16} />
          {/if}
          <span class="player-play-label">
            {#each reservedPlayLabels as reservedLabel (reservedLabel)}
              <span class="player-play-reserve" aria-hidden="true">{reservedLabel}</span>
            {/each}
            <span>{started && !paused ? m.player_pause() : effectivePlayLabel}</span>
          </span>
        </button>
        {#if showTransportExtras}
          <button
            type="button"
            class="btn-icon"
            onclick={() => transport.skip()}
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
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span>{m.trainer_label_settings()}</span>
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
                value={charWpm}
                min="5"
                max="50"
                class="input"
                onchange={(event) => commitSetting('charWpm', event)}
              />
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_eff_wpm()}</span>
              <input
                type="number"
                value={effWpm}
                min="5"
                max={settings.charWpm}
                class="input"
                onchange={(event) => commitSetting('effWpm', event)}
              />
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_freq()}</span>
              <input
                type="number"
                value={freq}
                min="300"
                max="2000"
                class="input"
                onchange={(event) => commitSetting('freq', event)}
              />
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.player_volume()}</span>
              <div class="player-volume-row">
                <input
                  type="range"
                  value={volume}
                  min="0"
                  max="1"
                  step="0.05"
                  class="player-volume-slider"
                  onchange={(event) => commitSetting('volume', event)}
                />
                <span class="player-volume-value">{Math.round(volume * 100)}%</span>
              </div>
            </label>
            <label class="player-settings-field">
              <span class="label-text">{m.trainer_label_start_delay()}</span>
              <input
                type="number"
                value={startDelay}
                min="0"
                max="10"
                step="0.5"
                class="input"
                onchange={(event) => commitSetting('startDelay', event)}
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
  {#if playback.failed}
    <p class="player-error" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      {m.player_audio_error()}
    </p>
  {/if}
</div>

<style>
  .player-wrapper {
    --player-control-height: var(--answer-target-min);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .player-error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--status-bad);
    font-size: var(--text-sm);
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

  .player-media-controls button {
    min-width: var(--player-control-height);
    min-height: var(--player-control-height);
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

  .player-play-label {
    display: grid;
    min-width: 0;
    text-align: center;
  }

  .player-play-label > span {
    grid-area: 1 / 1;
  }

  .player-play-reserve {
    visibility: hidden;
    /* Primary and quiet controls have different weights; keep sizing stable. */
    font-weight: 600;
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
    min-width: var(--player-control-height);
    padding-inline: var(--space-3);
    gap: var(--space-2);
    font-size: var(--text-sm);
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
      gap: var(--space-2);
    }

    .player-inline-timer {
      font-size: var(--text-xs);
      letter-spacing: -0.01em;
    }
  }
</style>

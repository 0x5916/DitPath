<script lang="ts">
  import type { Snippet } from 'svelte';
  import { browser } from '$app/env';
  import { ArrowLeft, Pause, Play } from '@lucide/svelte';
  import SessionProgress from './SessionProgress.svelte';
  import ExitSessionDialog from './ExitSessionDialog.svelte';
  import { acceptsSessionEscape } from './keyboard';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    currentPromptIndex: number;
    totalPrompts: number;
    isPaused?: boolean;
    canPause?: boolean;
    complete?: boolean;
    busy?: boolean;
    onExit: () => void;
    onExitRequest?: () => void;
    onExitCancel?: () => void;
    onPauseToggle?: () => void;
    children?: Snippet;
  }

  let {
    currentPromptIndex = 0,
    totalPrompts = 1,
    isPaused = false,
    canPause = true,
    complete = false,
    busy = false,
    onExit = () => {},
    onExitRequest = () => {},
    onExitCancel = () => {},
    onPauseToggle = () => {},
    children
  }: Props = $props();

  let showExitConfirm = $state(false);
  let exitButton = $state<HTMLButtonElement | null>(null);
  let returnFocusTo = $state<HTMLElement | null>(null);

  function handleExitClick() {
    if (showExitConfirm || busy) return;
    if (complete) return onExit();
    returnFocusTo =
      browser && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onExitRequest();
    showExitConfirm = true;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (showExitConfirm || !acceptsSessionEscape(event)) return;
    event.preventDefault();
    handleExitClick();
  }

  function handleConfirmExit() {
    showExitConfirm = false;
    onExit();
  }

  function handleCancelExit() {
    showExitConfirm = false;
    onExitCancel();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="session-shell">
  <header class="session-header">
    <button
      type="button"
      class="btn-icon"
      aria-label={complete ? m.lesson_result_finish() : m.lesson_exit()}
      title={complete ? m.lesson_result_finish() : m.lesson_exit()}
      disabled={busy}
      {@attach (button) => {
        exitButton = button;
        return () => {
          exitButton = null;
        };
      }}
      onclick={handleExitClick}
    >
      <ArrowLeft size={18} />
    </button>

    <div class="session-progress-container">
      <SessionProgress
        current={Math.min(currentPromptIndex + 1, totalPrompts)}
        total={totalPrompts}
      />
    </div>

    {#if canPause}
      <button
        type="button"
        class="btn-icon"
        aria-label={isPaused ? m.lesson_resume() : m.lesson_pause()}
        title={isPaused ? m.lesson_resume() : m.lesson_pause()}
        onclick={onPauseToggle}
      >
        {#if isPaused}
          <Play size={18} />
        {:else}
          <Pause size={18} />
        {/if}
      </button>
    {:else}
      <div class="header-spacer"></div>
    {/if}
  </header>

  <div class="session-stage">
    <div class="session-content">
      {#if children}
        {@render children()}
      {/if}
    </div>
  </div>

  <ExitSessionDialog
    isOpen={showExitConfirm}
    onConfirm={handleConfirmExit}
    onCancel={handleCancelExit}
    {returnFocusTo}
    fallbackFocus={exitButton}
  />
</div>

<style>
  .session-shell {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    min-height: 100dvh;
    background-color: var(--bg-base);
    color: var(--text-primary);
    overflow-x: hidden;
  }

  .session-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: calc(var(--space-3) + env(safe-area-inset-top, 0px));
    padding-right: calc(var(--space-4) + env(safe-area-inset-right, 0px));
    padding-bottom: var(--space-3);
    padding-left: calc(var(--space-4) + env(safe-area-inset-left, 0px));
    border-bottom: 1px solid var(--border);
    background-color: var(--bg-surface);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .session-progress-container {
    flex: 1;
    display: flex;
    justify-content: center;
    max-width: 14rem;
    margin: 0 var(--space-3);
  }

  .header-spacer {
    width: var(--answer-target-min);
  }

  .session-header button {
    min-width: var(--answer-target-min);
    min-height: var(--answer-target-min);
  }

  .session-stage {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    padding-top: var(--space-4);
    padding-right: calc(var(--space-4) + env(safe-area-inset-right, 0px));
    padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
    padding-left: calc(var(--space-4) + env(safe-area-inset-left, 0px));
  }

  .session-content {
    width: 100%;
    max-width: var(--session-max-width, 42rem);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin: auto 0;
  }

  @media (max-width: 480px) {
    .session-header {
      padding-top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
      padding-right: calc(var(--space-3) + env(safe-area-inset-right, 0px));
      padding-bottom: var(--space-2);
      padding-left: calc(var(--space-3) + env(safe-area-inset-left, 0px));
    }
  }

  @container (width < 18rem) {
    .session-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }
    .session-header button {
      justify-self: start;
    }
    .session-header button:last-child,
    .header-spacer {
      justify-self: end;
    }
    .session-progress-container {
      grid-row: 2;
      grid-column: 1 / -1;
      max-width: none;
      margin: 0;
    }
  }
</style>

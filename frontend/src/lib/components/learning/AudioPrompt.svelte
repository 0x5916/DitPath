<script lang="ts">
  import { Volume2, RotateCcw, Play } from '@lucide/svelte';
  import type { GuidedSessionPhase } from '../../training/v2/guided-session';
  import { acceptsSessionShortcut } from './keyboard';

  interface Props {
    phase: GuidedSessionPhase;
    replayCount?: number;
    audioError?: string | null;
    isIntro?: boolean;
    introCharacter?: string;
    onPlay: () => void;
    onReplay: () => void;
  }

  let {
    phase,
    replayCount = 0,
    audioError = null,
    isIntro = false,
    introCharacter = '',
    onPlay = () => {},
    onReplay = () => {}
  }: Props = $props();

  let isPlaying = $derived(phase === 'playing');
  let canReplay = $derived(phase === 'answering');
  let canPlay = $derived(phase === 'ready' || phase === 'introducing');

  function handleKeydown(event: KeyboardEvent) {
    if (event.code === 'Space' && acceptsSessionShortcut(event) && (canPlay || canReplay)) {
      event.preventDefault();
      if (canPlay) {
        onPlay();
      } else if (canReplay) {
        onReplay();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="audio-prompt-container">
  {#if isIntro}
    <div class="intro-badge">New Sound</div>
    <div class="intro-character" aria-label={`New character: ${introCharacter}`}>
      {introCharacter}
    </div>
    <p class="intro-hint">Listen to the rhythm and musical shape. Do not count dots and dashes.</p>
  {:else}
    <div class="prompt-title">Which character?</div>
  {/if}

  <div class="audio-control-zone">
    {#if isPlaying}
      <div class="pulse-indicator" role="status" aria-label="Playing audio tone">
        <span class="pulse-icon">
          <Volume2 size={36} />
        </span>
        <span class="pulse-label">Listening…</span>
      </div>
    {:else if canReplay}
      <button
        type="button"
        class="replay-button"
        onclick={onReplay}
        aria-label="Replay Morse tone (Space)"
      >
        <RotateCcw size={22} />
        <span>Replay</span>
      </button>
    {:else if canPlay}
      <button
        type="button"
        class="play-button"
        onclick={onPlay}
        aria-label="Play Morse tone (Space)"
      >
        <Play size={26} />
        <span>Play sound</span>
      </button>
    {/if}
  </div>

  <div class="audio-meta">
    {#if canReplay}
      <span class="meta-item">Press <kbd class="kbd">Space</kbd> to replay</span>
      {#if replayCount > 0}
        <span class="meta-item meta-replay-count">
          {replayCount}
          {replayCount === 1 ? 'replay' : 'replays'}
        </span>
      {/if}
    {:else if canPlay}
      <span class="meta-item">Press <kbd class="kbd">Space</kbd> or click to play</span>
    {/if}

    {#if audioError}
      <div class="audio-error-notice" role="alert">
        <span>Audio problem: {audioError}</span>
        <button type="button" class="btn-ghost" onclick={onPlay}>Retry</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .audio-prompt-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    margin-bottom: var(--space-6);
  }

  .intro-badge {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--learning-current, var(--accent));
  }

  .intro-character {
    font-family: var(--font-mono);
    font-size: 3.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    margin: var(--space-2) 0;
  }

  .intro-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    max-width: 24rem;
    line-height: var(--leading-normal);
  }

  .prompt-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .audio-control-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 4.5rem;
  }

  .pulse-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--learning-current, var(--accent));
  }

  .pulse-icon {
    animation: pulse-glow 1.2s ease-in-out infinite;
  }

  .pulse-label {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .play-button,
  .replay-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: var(--answer-target-min, 3rem);
    min-height: var(--answer-target-min, 3rem);
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .play-button {
    background-color: var(--accent-cta);
    color: var(--on-accent);
    border: 1px solid var(--accent);
  }

  .play-button:hover {
    background-color: var(--accent-cta-h);
  }

  .replay-button {
    background-color: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-control);
  }

  .replay-button:hover {
    background-color: var(--bg-inset);
    border-color: var(--accent);
  }

  .audio-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    min-height: 1.5rem;
  }

  .meta-item {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .meta-replay-count {
    color: var(--text-secondary);
  }

  .kbd {
    display: inline-block;
    padding: 0.1rem 0.35rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background-color: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
  }

  .audio-error-notice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background-color: var(--status-bad-tint);
    color: var(--status-bad);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }

  @keyframes pulse-glow {
    0%,
    100% {
      opacity: 0.6;
      transform: scale(0.96);
    }
    50% {
      opacity: 1;
      transform: scale(1.04);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse-icon {
      animation: none;
    }
  }
</style>

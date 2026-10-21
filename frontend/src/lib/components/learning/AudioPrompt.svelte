<script lang="ts">
  import { Volume2, RotateCcw, Play, CircleAlert } from '@lucide/svelte';
  import type { GuidedSessionPhase } from '../../training/v2/guided-session';
  import { acceptsSessionShortcut } from './keyboard';
  import * as m from '#lib/paraglide/messages.js';

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
    if (
      event.code === 'Space' &&
      !event.shiftKey &&
      acceptsSessionShortcut(event) &&
      (canPlay || canReplay)
    ) {
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
    <div class="intro-badge">{m.lesson_new_sound()}</div>
    <div
      class="intro-character"
      role="img"
      aria-label={m.lesson_new_character_label({ character: introCharacter })}
    >
      {introCharacter}
    </div>
    <p class="intro-hint">{m.lesson_intro_hint()}</p>
  {:else}
    <div class="prompt-title">{m.lesson_prompt_question()}</div>
  {/if}

  <div class="audio-control-zone">
    {#if isPlaying}
      <div class="pulse-indicator" role="status" aria-label={m.lesson_playing_audio()}>
        <span class="pulse-icon">
          <Volume2 size={36} aria-hidden="true" />
        </span>
        <span class="pulse-label">{m.lesson_listening()}</span>
      </div>
    {:else if canReplay}
      <button type="button" class="replay-button" onclick={onReplay} aria-keyshortcuts="Space">
        <RotateCcw size={22} aria-hidden="true" />
        <span>{m.lesson_replay_sound()}</span>
      </button>
    {:else if canPlay}
      <button type="button" class="play-button" onclick={onPlay} aria-keyshortcuts="Space">
        <Play size={26} aria-hidden="true" />
        <span>{m.lesson_play_sound()}</span>
      </button>
    {/if}
  </div>

  <div class="audio-meta">
    {#if canReplay}
      <span class="meta-item">{m.lesson_hint_replay()}</span>
      {#if replayCount > 0}
        <span class="meta-item meta-replay-count">
          {replayCount === 1
            ? m.lesson_replay_count_one()
            : m.lesson_replay_count({ count: replayCount })}
        </span>
      {/if}
    {:else if canPlay}
      <span class="meta-item">{m.lesson_hint_play()}</span>
    {/if}

    {#if audioError}
      <div class="audio-error-notice" role="alert">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{m.lesson_feedback_audio_error()}</span>
        {#if canPlay || canReplay}
          <button type="button" class="btn-ghost" onclick={canReplay ? onReplay : onPlay}>
            {m.lesson_audio_retry()}
          </button>
        {/if}
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
    color: var(--learning-current);
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
    color: var(--learning-current);
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
    min-width: var(--answer-target-min);
    min-height: var(--answer-target-min);
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

  .audio-error-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background-color: var(--status-bad-tint);
    color: var(--status-bad);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }

  .audio-error-notice button {
    min-height: var(--answer-target-min);
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

    .play-button,
    .replay-button {
      transition: none;
    }
  }
</style>

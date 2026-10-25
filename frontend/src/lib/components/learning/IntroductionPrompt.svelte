<script lang="ts">
  import { Check, CircleAlert, Play, RotateCcw, Volume2 } from '@lucide/svelte';
  import type { GuidedSessionPhase } from '../../training/v2/guided-session';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    phase: GuidedSessionPhase;
    character: string;
    hasPlayed: boolean;
    audioError: string | null;
    onPlay: () => void;
    onContinue: () => void;
  }

  let { phase, character, hasPlayed, audioError, onPlay, onContinue }: Props = $props();
  let isPlaying = $derived(phase === 'playing');
  let canPlay = $derived(phase === 'introducing' || phase === 'ready');
  let canContinue = $derived(phase === 'introducing' && hasPlayed);

  function activate() {
    if (canContinue) onContinue();
    else if (canPlay) onPlay();
  }
</script>

<section class="introduction">
  <h1>{m.lesson_meet_character({ character })}</h1>
  <div class="character" aria-hidden="true">{character}</div>
  <p class="instruction">{m.lesson_intro_hint()}</p>

  <div class="actions">
    <p class="playback-status" role="status" class:heard={hasPlayed && !isPlaying}>
      {#if isPlaying}
        <Volume2 size={18} aria-hidden="true" /> {m.lesson_listening()}
      {:else if hasPlayed}
        <Check size={18} aria-hidden="true" /> {m.lesson_intro_heard()}
      {:else}
        {m.lesson_intro_listen_first()}
      {/if}
    </p>
    {#if audioError}
      <p class="audio-error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        {m.lesson_feedback_audio_error()}
      </p>
    {/if}
    <button
      type="button"
      class="btn-ghost replay"
      class:unheard={!hasPlayed}
      aria-hidden={!hasPlayed}
      disabled={!hasPlayed || !canPlay}
      onclick={onPlay}
    >
      <RotateCcw size={20} aria-hidden="true" />
      {m.lesson_hear_character({ character })}
    </button>
    <button
      type="button"
      class="btn-primary"
      aria-disabled={!canPlay}
      aria-busy={isPlaying}
      aria-keyshortcuts={canContinue ? 'Enter' : 'Space'}
      onclick={activate}
    >
      {#if isPlaying}
        {m.lesson_listening()}
      {:else if canContinue}
        {m.lesson_continue()}
      {:else}
        <Play size={20} aria-hidden="true" /> {m.lesson_listen_character({ character })}
      {/if}
    </button>
  </div>
</section>

<style>
  .introduction {
    width: 100%;
    max-width: 30rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding-block: var(--space-6);
  }
  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 600;
  }
  .character {
    font-family: var(--font-mono);
    font-size: clamp(5rem, 18vw, 7rem);
    font-weight: 600;
    line-height: 1.2;
  }
  .instruction {
    margin: 0;
    max-width: 26ch;
    color: var(--text-secondary);
    font-size: var(--text-base);
    line-height: var(--leading-normal);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-8);
  }
  .playback-status,
  .audio-error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .heard {
    color: var(--status-good);
  }
  .audio-error {
    color: var(--status-bad);
  }
  button {
    min-height: 3.5rem;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-base);
    gap: var(--space-2);
  }
  .replay {
    border: 1px solid var(--border-control);
  }
  .unheard {
    visibility: hidden;
  }
  .btn-primary[aria-disabled='true'] {
    background: var(--bg-inset);
    color: var(--text-muted);
    cursor: wait;
  }
</style>

<script lang="ts">
  import { Volume2 } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    charA: string;
    charB: string;
    playingCharacter?: string | null;
    onPlayA: () => void;
    onPlayB: () => void;
    onContinue: () => void;
  }

  let {
    charA,
    charB,
    playingCharacter = null,
    onPlayA = () => {},
    onPlayB = () => {},
    onContinue = () => {}
  }: Props = $props();
</script>

<div class="contrast-repair-card" role="region" aria-label="Sound contrast repair">
  <div class="contrast-title">Compare the sounds</div>
  <p class="contrast-subtitle">
    Listen to the contrast between these two rhythms before continuing.
  </p>

  <div class="contrast-columns">
    <div class="contrast-col">
      <div class="char-display">{charA}</div>
      <button
        type="button"
        class="btn-primary"
        onclick={onPlayA}
        aria-label={`Play sound for ${charA}`}
        aria-pressed={playingCharacter === charA}
      >
        <Volume2 size={18} />
        <span
          >{playingCharacter === charA
            ? m.lesson_playing_character({ character: charA })
            : `Play ${charA}`}</span
        >
      </button>
    </div>

    <div class="contrast-divider">vs</div>

    <div class="contrast-col">
      <div class="char-display">{charB}</div>
      <button
        type="button"
        class="btn-primary"
        onclick={onPlayB}
        aria-label={`Play sound for ${charB}`}
        aria-pressed={playingCharacter === charB}
      >
        <Volume2 size={18} />
        <span
          >{playingCharacter === charB
            ? m.lesson_playing_character({ character: charB })
            : `Play ${charB}`}</span
        >
      </button>
    </div>
  </div>

  <div class="contrast-actions">
    <button type="button" class="btn-primary" aria-keyshortcuts="Enter" onclick={onContinue}>
      {m.lesson_continue()} <kbd aria-hidden="true">Enter</kbd>
    </button>
  </div>
</div>

<style>
  .contrast-repair-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 28rem;
    box-shadow: var(--shadow-overlay);
  }

  .contrast-title {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
  }

  .contrast-subtitle {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    text-align: center;
    line-height: var(--leading-normal);
  }

  .contrast-columns {
    display: flex;
    align-items: center;
    justify-content: space-around;
    width: 100%;
    padding: var(--space-4) 0;
  }

  .contrast-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  .char-display {
    font-family: var(--font-mono);
    font-size: 2.75rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .contrast-divider {
    font-size: var(--text-sm);
    color: var(--text-muted);
    font-weight: 600;
  }

  .contrast-actions {
    margin-top: var(--space-2);
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .contrast-repair-card button {
    min-height: var(--answer-target-min, 3rem);
  }
</style>

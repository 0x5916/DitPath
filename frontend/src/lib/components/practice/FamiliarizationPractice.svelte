<script lang="ts">
  import { untrack } from 'svelte';
  import { MORSE, getLessonChars } from '../../training/sequence';
  import { practiceKeyIntent } from '../../practice/keyboard';
  import MorsePlayer from '../MorsePlayer.svelte';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    lesson?: number;
    charWpm?: number;
    effWpm?: number;
    freq?: number;
    volume?: number;
    onStartPassage?: () => void;
  }

  let {
    lesson = 1,
    charWpm = 20,
    effWpm = 12,
    freq = 600,
    volume = 1.0,
    onStartPassage = () => {}
  }: Props = $props();

  let activeLesson = $state(1);
  let availableChars = $derived(getLessonChars(activeLesson).split('').filter(Boolean));
  let selectedChar = $state('K');
  let charMorse = $derived(MORSE[selectedChar] ?? '');
  let drillPlayed = $state(false);
  let drillPlaying = $state(false);
  let player = $state<{
    playNow: () => Promise<void>;
    stopNow: () => Promise<void>;
  } | null>(null);

  $effect.pre(() => {
    activeLesson = lesson;
    const chars = getLessonChars(lesson).split('').filter(Boolean);
    untrack(() => {
      void player?.stopNow();
      selectedChar = chars[0] ?? 'K';
      drillPlayed = false;
      drillPlaying = false;
    });
  });

  function handleSelectChar(ch: string) {
    if (ch === selectedChar) return;
    void player?.stopNow();
    selectedChar = ch;
    drillPlayed = false;
    drillPlaying = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    const intent = practiceKeyIntent(event);
    if (intent === 'replay') {
      event.preventDefault();
      void player?.playNow();
    } else if (intent === 'stop' && drillPlaying) {
      event.preventDefault();
      void player?.stopNow();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="familiarization-practice"
  role="region"
  aria-label={m.practice_familiarization_region()}
>
  <div class="drill-header">
    <h2 class="drill-title">{m.trainer_drill_label()}</h2>
    <p class="drill-meta">
      {m.trainer_summary_meta_drill({
        count: String(availableChars.length),
        speed: `${charWpm}/${effWpm}`,
        hz: String(freq)
      })}
    </p>
  </div>

  <div class="char-hero">
    <div class="display-character">{selectedChar}</div>
    {#if charMorse}
      <div class="display-morse" aria-label={`${m.trainer_drill_morse()}: ${charMorse}`}>
        {charMorse}
      </div>
    {/if}
  </div>

  <div class="player-container">
    <MorsePlayer
      bind:this={player}
      text={Array(5).fill(selectedChar).join('')}
      {charWpm}
      {effWpm}
      {freq}
      {volume}
      showSettings={false}
      showTransportExtras={false}
      onStart={() => {
        drillPlaying = true;
        drillPlayed = true;
      }}
      onEnded={() => (drillPlaying = false)}
      playTone={drillPlayed && !drillPlaying ? 'quiet' : 'primary'}
      playLabel={drillPlayed ? m.trainer_replay() : m.trainer_drill_play()}
      reservePlayLabels={[m.trainer_drill_play(), m.player_pause(), m.trainer_replay()]}
      label={m.trainer_drill_audio()}
    />
  </div>

  <div class="char-picker-section" role="group" aria-label={m.trainer_choose_letter()}>
    <div class="char-chips">
      {#each availableChars as ch (ch)}
        <button
          type="button"
          class="char-chip"
          class:is-active={ch === selectedChar}
          onclick={() => handleSelectChar(ch)}
          aria-label={m.practice_inspect_character({ character: ch })}
          aria-pressed={ch === selectedChar}
        >
          {ch}
        </button>
      {/each}
    </div>
  </div>

  <div class="drill-actions">
    <button
      type="button"
      class={drillPlayed ? 'btn-primary' : 'btn-ghost'}
      onclick={onStartPassage}
    >
      {m.trainer_drill_cta()}
    </button>
  </div>
</div>

<style>
  .familiarization-practice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow);
  }

  .drill-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .drill-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .drill-meta {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .char-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
  }

  .display-character {
    font-family: var(--font-mono);
    font-size: 4.5rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text-primary);
  }

  .display-morse {
    font-family: var(--font-mono);
    font-size: 1.75rem;
    letter-spacing: 0.15em;
    color: var(--learning-current);
  }

  .player-container {
    display: flex;
    justify-content: center;
  }

  .char-picker-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .char-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    max-width: 32rem;
  }

  .char-chip {
    min-width: var(--answer-target-min);
    min-height: var(--answer-target-min);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 700;
    background-color: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .char-chip:hover {
    background-color: var(--bg-surface);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .char-chip.is-active {
    background-color: var(--bg-surface);
    border-color: var(--learning-current);
    color: var(--learning-current);
    box-shadow: inset 0 0 0 1px var(--learning-current);
  }

  .drill-actions {
    margin-top: var(--space-2);
  }
</style>

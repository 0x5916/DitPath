<script lang="ts">
  import { MORSE, getLessonChars } from '../../morse';
  import MorsePlayer from '../MorsePlayer.svelte';
  import * as m from '$lib/paraglide/messages';

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

  $effect.pre(() => {
    activeLesson = lesson;
    const chars = getLessonChars(lesson).split('').filter(Boolean);
    selectedChar = chars[0] ?? 'K';
  });

  let isLetter = (c: string) => /[A-Z]/.test(c);
  let isNumber = (c: string) => /[0-9]/.test(c);
  let letterChars = $derived(availableChars.filter(isLetter));
  let numberChars = $derived(availableChars.filter(isNumber));
  let symbolChars = $derived(availableChars.filter((c) => !isLetter(c) && !isNumber(c)));
  let latestChars = $derived(availableChars.slice(-7));

  let learnedLabel = $derived(
    availableChars.length === 1
      ? m.trainer_set_learned_one()
      : m.trainer_set_learned({ count: String(availableChars.length) })
  );

  let player = $state<{
    playNow: () => Promise<void>;
    stopNow: () => Promise<void>;
  } | null>(null);

  function handleSelectChar(ch: string) {
    selectedChar = ch;
    drillPlayed = false;
  }
</script>

<div class="familiarization-practice" role="region" aria-label="Character familiarization">
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
      label={m.trainer_drill_audio()}
    />
  </div>

  <p class="drill-focus">{m.trainer_drill_focus()}</p>

  <div class="char-picker-section">
    <label class="field drill-picker-field">
      <span class="label-text">{m.trainer_choose_letter()}</span>
      <select
        class="select drill-picker"
        value={selectedChar}
        onchange={(e) => handleSelectChar((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each availableChars as char (char)}
          <option value={char}>{char}</option>
        {/each}
      </select>
    </label>

    <div class="char-chips">
      {#each availableChars as ch (ch)}
        <button
          type="button"
          class="char-chip"
          class:is-active={ch === selectedChar}
          onclick={() => handleSelectChar(ch)}
          aria-label={`Inspect ${ch}`}
        >
          {ch}
        </button>
      {/each}
    </div>
  </div>

  <details class="charset-details">
    <summary class="charset-toggle">{m.trainer_view_set()}</summary>
    <div class="charset-content">
      <p class="panel-label">{m.trainer_set_title()}</p>
      <p class="learned-count">{learnedLabel}</p>
      {#if letterChars.length > 0}
        <div class="charset-group">
          <span class="group-name">{m.trainer_set_letters()} · {letterChars.length}</span>
          <span class="group-chars">{letterChars.join(' ')}</span>
        </div>
      {/if}
      {#if numberChars.length > 0}
        <div class="charset-group">
          <span class="group-name">{m.trainer_set_numbers()} · {numberChars.length}</span>
          <span class="group-chars">{numberChars.join(' ')}</span>
        </div>
      {/if}
      {#if symbolChars.length > 0}
        <div class="charset-group">
          <span class="group-name">{m.trainer_set_symbols()} · {symbolChars.length}</span>
          <span class="group-chars">{symbolChars.join(' ')}</span>
        </div>
      {/if}
      <p class="latest-row">{m.trainer_set_latest({ chars: latestChars.join(' ') })}</p>
    </div>
  </details>

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
    max-width: var(--max-width-narrow, 46rem);
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
    color: var(--learning-current, var(--accent));
  }

  .player-container {
    display: flex;
    justify-content: center;
  }

  .drill-focus {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    text-align: center;
  }

  .char-picker-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .drill-picker-field {
    max-width: 12rem;
  }

  .char-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    max-width: 32rem;
  }

  .char-chip {
    min-width: var(--answer-target-min, 3rem);
    min-height: var(--answer-target-min, 3rem);
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
    border-color: var(--learning-current, var(--accent));
    color: var(--learning-current, var(--accent));
    box-shadow: inset 0 0 0 1px var(--learning-current, var(--accent));
  }

  .charset-details {
    width: 100%;
    max-width: 28rem;
    font-size: var(--text-xs);
  }

  .charset-toggle {
    color: var(--accent);
    cursor: pointer;
    text-align: center;
    text-decoration: underline;
  }

  .charset-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding: var(--space-3);
    background-color: var(--bg-inset);
    border-radius: var(--radius-sm);
  }

  .panel-label {
    margin: 0;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .learned-count {
    margin: 0;
    color: var(--text-secondary);
  }

  .charset-group {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .group-name {
    color: var(--text-muted);
  }

  .group-chars {
    font-family: var(--font-mono);
    color: var(--text-primary);
  }

  .latest-row {
    margin: 0;
    color: var(--text-muted);
  }

  .drill-actions {
    margin-top: var(--space-2);
  }
</style>

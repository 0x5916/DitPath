<script lang="ts">
  import { Check, CircleAlert, Play, RotateCcw, Volume2 } from '@lucide/svelte';
  import type { GuidedSessionPhase } from '../../training/v2/guided-session';
  import { acceptsSessionShortcut } from './keyboard';
  import CharacterGrid from './CharacterGrid.svelte';
  import AnswerInput from './AnswerInput.svelte';
  import type { AttemptClassification, InputMode } from '../../training/v2/types';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    phase: GuidedSessionPhase;
    typed?: boolean;
    scored: boolean;
    firstRecall?: boolean;
    draft?: string;
    classification?: AttemptClassification;
    options: string[];
    expected: string;
    entered?: string;
    isCorrect?: boolean;
    playingCharacter: string | null;
    audioError: string | null;
    onPlay: () => void;
    onReplay: () => void;
    onSelect: (character: string) => void;
    onSubmit: (text: string, mode: InputMode) => void;
    onHear: (character: string) => void;
    onContinue: () => void;
  }

  let {
    phase,
    typed = false,
    scored,
    firstRecall = false,
    draft = $bindable(''),
    classification,
    options,
    expected,
    entered = '',
    isCorrect = false,
    playingCharacter,
    audioError,
    onPlay,
    onReplay,
    onSelect,
    onSubmit,
    onHear,
    onContinue
  }: Props = $props();
  let feedback = $derived(phase === 'feedback');
  let playing = $derived(phase === 'playing');
  function focusHeading(heading: HTMLElement) {
    heading.focus();
  }

  function play() {
    if (feedback && playingCharacter !== expected) onHear(expected);
    else if (phase === 'answering') onReplay();
    else if (phase === 'ready') onPlay();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.code === 'Space' && !event.shiftKey && acceptsSessionShortcut(event)) {
      event.preventDefault();
      play();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="recognition">
  {#if feedback}
    <header>
      <h1 tabindex="-1" class:correct={isCorrect} {@attach focusHeading}>
        {#if isCorrect}<Check size={24} aria-hidden="true" />
        {:else}<CircleAlert size={24} aria-hidden="true" />{/if}
        {isCorrect
          ? m.lesson_warmup_correct({ character: expected })
          : m.lesson_warmup_expected({ character: expected })}
      </h1>
      {#if !isCorrect}<p>
          {typed
            ? m.lesson_recall_compare({ text: entered })
            : m.lesson_warmup_compare({ character: entered })}
        </p>{/if}
    </header>
    <div class="sounds" class:single={isCorrect}>
      {#each isCorrect ? [expected] : [entered, expected] as character (character)}
        <div class="sound">
          <p>
            {character === expected ? m.lesson_feedback_expected() : m.lesson_feedback_entered()}
          </p>
          <span class="character" aria-hidden="true">{character}</span>
          <button
            type="button"
            class="btn-ghost"
            aria-disabled={playingCharacter === character}
            aria-busy={playingCharacter === character}
            onclick={() => {
              if (playingCharacter !== character) onHear(character);
            }}
          >
            <Volume2 size={20} aria-hidden="true" />
            {playingCharacter === character
              ? m.lesson_playing_character({ character })
              : m.lesson_hear_character({ character })}
          </button>
        </div>
      {/each}
    </div>
    {#if !scored || isCorrect}<p class="reassurance">
        {#if !scored}{m.lesson_warmup_unscored()}
        {:else if isCorrect && classification === 'automatic'}{m.lesson_feedback_automatic()}
        {:else}{m.lesson_feedback_developing()}{/if}
      </p>{/if}
    <footer>
      <button type="button" class="btn-primary" aria-keyshortcuts="Enter" onclick={onContinue}>
        {m.lesson_continue()}
      </button>
    </footer>
  {:else}
    <header>
      <h1 tabindex="-1" {@attach focusHeading}>
        {firstRecall ? m.lesson_recall_start() : m.lesson_prompt_question()}
      </h1>
      {#if firstRecall}<p>{m.lesson_recall_scored()}</p>{/if}
    </header>
    <button
      type="button"
      class={phase === 'ready' ? 'btn-primary' : 'btn-ghost'}
      aria-disabled={playing}
      aria-busy={playing}
      aria-keyshortcuts="Space"
      onclick={play}
    >
      {#if playing}<Volume2 size={20} aria-hidden="true" /> {m.lesson_listening()}
      {:else if phase === 'answering'}<RotateCcw size={20} aria-hidden="true" />
        {m.lesson_replay_sound()}
      {:else}<Play size={20} aria-hidden="true" /> {m.lesson_play_sound()}{/if}
    </button>
    {#if typed}
      <AnswerInput
        bind:value={draft}
        expectedLength={expected.length}
        disabled={phase !== 'answering'}
        {onSubmit}
        onReplay={play}
      />
    {:else}
      <CharacterGrid {options} large disabled={phase !== 'answering'} {onSelect} />
    {/if}
    {#if audioError}<p class="notice" role="alert">{m.lesson_feedback_audio_error()}</p>{/if}
    <p class="reassurance" role="status">
      {playing ? m.lesson_listening() : scored ? '' : m.lesson_warmup_hint()}
    </p>
    <footer><p>{phase === 'answering' ? m.lesson_hint_replay() : m.lesson_hint_play()}</p></footer>
  {/if}
</section>

<style>
  .recognition {
    width: 100%;
    max-width: 30rem;
    min-height: min(36rem, calc(100dvh - 8rem));
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-block: var(--space-4);
  }
  header {
    min-height: 6rem;
  }
  h1 {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 600;
    line-height: var(--leading-tight);
  }
  h1 :global(svg) {
    flex-shrink: 0;
    color: var(--status-bad);
  }
  h1:focus {
    outline: none;
  }
  h1.correct :global(svg) {
    color: var(--status-good);
  }
  p {
    margin: 0;
    color: var(--text-secondary);
  }
  header p {
    margin-top: var(--space-3);
  }
  .sounds {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .sounds.single {
    grid-template-columns: minmax(0, 1fr);
  }
  .sound {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
  }
  .sound p {
    font-size: var(--text-sm);
  }
  .character {
    font-family: var(--font-mono);
    font-size: 3.5rem;
    line-height: 1.2;
    font-weight: 600;
  }
  button {
    width: 100%;
    min-height: 3.5rem;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--text-base);
  }
  .btn-ghost {
    border: 1px solid var(--border-control);
  }
  button[aria-disabled='true'] {
    color: var(--text-muted);
    cursor: wait;
  }
  .notice {
    color: var(--status-bad);
  }
  .reassurance,
  footer p {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  footer {
    margin-top: auto;
    padding-top: var(--space-6);
  }
</style>

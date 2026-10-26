<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowRight, CircleCheck, CircleX, Play, Square } from '@lucide/svelte';
  import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.ts';
  import { acceptsSessionShortcut } from '#lib/components/learning/keyboard.ts';
  import { buildAudioPlan } from '#lib/training/timing.ts';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import { getLessonCharacterSet } from '#lib/training/sequence.ts';
  import * as m from '#lib/paraglide/messages.js';

  const PREVIEW_LESSON = 1;
  const previewChars = getLessonCharacterSet(PREVIEW_LESSON);
  const samplePlans = Object.fromEntries(
    previewChars.map((char) => [
      char,
      buildAudioPlan(char, { charWpm: 20, effWpm: 20, volume: 0.2 })
    ])
  );
  let sampleCharacter = $state<string | null>(null);
  let sampleError = $state(false);
  let heardCharacters = $state<string[]>([]);
  let quizCharacter = $state<string | null>(null);
  let quizAnswer = $state<string | null>(null);
  let previewFrame = $state<HTMLElement | null>(null);
  let audio: AudioEngine | null = null;

  function clearSample() {
    sampleCharacter = null;
  }

  onMount(() => {
    audio = createWebAudioEngine();
    const unsubscribe = audio.subscribe(() => {
      if (audio?.isActive()) return;
      if (sampleCharacter && !quizCharacter && !heardCharacters.includes(sampleCharacter)) {
        heardCharacters = [...heardCharacters, sampleCharacter];
      }
      clearSample();
    });
    return () => {
      unsubscribe();
      clearSample();
      void audio?.dispose();
      audio = null;
    };
  });

  function playSample(character: string) {
    if (!audio) return;
    sampleError = false;
    if (sampleCharacter === character) {
      clearSample();
      void audio.stop({ notify: false });
      return;
    }
    try {
      clearSample();
      audio.play(samplePlans[character]);
      sampleCharacter = character;
    } catch {
      clearSample();
      sampleError = true;
      void audio.stop({ notify: false });
    }
  }

  function focusPreview(selector = 'button') {
    void tick().then(() => previewFrame?.querySelector<HTMLElement>(selector)?.focus());
  }

  function startQuiz() {
    quizCharacter = previewChars[Math.floor(Math.random() * previewChars.length)];
    quizAnswer = null;
    clearSample();
    playSample(quizCharacter);
    focusPreview();
  }

  function answerQuiz(character: string) {
    if (!sampleCharacter && !sampleError && !quizAnswer) {
      quizAnswer = character;
      focusPreview('.quiz-actions a');
    }
  }

  function handlePreviewKeydown(event: KeyboardEvent) {
    if (!quizCharacter || !acceptsSessionShortcut(event)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      quizAnswer = null;
      clearSample();
      playSample(quizCharacter);
    } else if (event.key === 'Enter' && quizAnswer) {
      event.preventDefault();
      startQuiz();
    }
  }

  function returnToSamples() {
    clearSample();
    void audio?.stop({ notify: false });
    quizCharacter = null;
    quizAnswer = null;
    sampleError = false;
    focusPreview();
  }

  function stopHiddenSample() {
    if (document.hidden) {
      clearSample();
      void audio?.stop({ notify: false });
    }
  }
</script>

<svelte:document onvisibilitychange={stopHiddenSample} />
<svelte:window onkeydown={handlePreviewKeydown} />

<div class="masthead-preview">
  <!-- Introductory listening stays separate from the optional recognition quiz. -->
  <figure class="preview-frame" aria-labelledby="home-preview-title" bind:this={previewFrame}>
    <div class="preview-heading">
      <h2 id="home-preview-title" class="preview-title">{m.home_preview_title()}</h2>
    </div>
    {#if quizCharacter}
      <p class="quiz-question">{m.home_quiz_question()}</p>
      <button
        type="button"
        class="btn-ghost preview-control"
        onclick={() => {
          quizAnswer = null;
          playSample(quizCharacter!);
        }}
      >
        {#if sampleCharacter}<Square size={16} aria-hidden="true" />{:else}<Play
            size={16}
            aria-hidden="true"
          />{/if}
        {sampleCharacter ? m.player_stop() : m.home_quiz_replay()}
      </button>
      <div class="preview-chars">
        {#each previewChars as char (char)}
          <button
            type="button"
            class="preview-char sample-letter"
            disabled={!!sampleCharacter || sampleError || !!quizAnswer}
            onclick={() => answerQuiz(char)}>{char}</button
          >
        {/each}
      </div>
      <p class="sample-status body-text" role="status" aria-atomic="true">
        {#if quizAnswer}
          {#if quizAnswer === quizCharacter}<CircleCheck
              size={18}
              aria-hidden="true"
            />{:else}<CircleX size={18} aria-hidden="true" />{/if}
          {quizAnswer === quizCharacter
            ? m.home_quiz_correct({ character: quizCharacter })
            : m.home_quiz_incorrect({ character: quizCharacter })}
        {:else}{m.home_quiz_playing()}{/if}
      </p>
      <div class="quiz-actions">
        {#if quizAnswer}
          <a href={href('/morse/learn/session?step=1')} class="btn-cta preview-control"
            >{m.home_cta()}<ArrowRight size={18} aria-hidden="true" /></a
          >
        {/if}
        {#if quizAnswer}<button type="button" class="btn-ghost preview-control" onclick={startQuiz}
            >{m.home_quiz_again()}</button
          >{/if}
        <button type="button" class="btn-ghost preview-control" onclick={returnToSamples}
          >{m.home_quiz_back()}</button
        >
      </div>
    {:else}
      <div class="preview-chars">
        {#each previewChars as char (char)}
          <button
            type="button"
            class="preview-char"
            aria-label={sampleCharacter === char
              ? m.home_sample_stop({ character: char })
              : heardCharacters.includes(char)
                ? m.home_sample_replay({ character: char })
                : m.home_sample_play({ character: char })}
            aria-pressed={sampleCharacter === char}
            onclick={() => playSample(char)}
          >
            <span class="sample-letter">{char}</span>
            <span class="sample-action">
              {#if sampleCharacter === char}<Square size={16} aria-hidden="true" />
              {:else if heardCharacters.includes(char)}<CircleCheck size={16} aria-hidden="true" />
              {:else}<Play size={16} aria-hidden="true" />{/if}
              {sampleCharacter === char
                ? m.player_stop()
                : heardCharacters.includes(char)
                  ? m.home_quiz_replay()
                  : m.home_step1_title()}
            </span>
          </button>
        {/each}
      </div>
      <p class="sample-status body-text" aria-live="polite" aria-atomic="true">
        {sampleCharacter
          ? m.home_sample_playing({ character: sampleCharacter })
          : heardCharacters.length === previewChars.length
            ? m.home_sample_ready()
            : m.home_sample_hint()}
      </p>
      {#if heardCharacters.length === previewChars.length}
        <button type="button" class="btn-ghost preview-control" onclick={startQuiz}
          >{m.home_quiz_start()}</button
        >
      {/if}
    {/if}
    {#if sampleError}<p class="sample-error body-text" role="alert">
        {m.home_sample_error()}
      </p>{/if}
    <p class="body-text audio-hint">{m.home_audio_hint()}</p>
  </figure>
</div>

<style>
  .masthead-preview {
    min-width: 0;
  }

  .preview-frame {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: var(--space-3);
    width: 100%;
    margin: 0;
    padding: 0;
    text-align: left;
  }

  .preview-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .preview-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-snug);
  }

  .preview-chars {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: 0;
    color: var(--text-primary);
  }

  .preview-char {
    display: flex;
    flex-direction: column;
    flex: 1;
    justify-content: center;
    align-items: center;
    gap: var(--space-4);
    min-width: var(--answer-target-min);
    min-height: 12rem;
    padding: var(--space-5) var(--space-3);
    text-align: center;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-lg);
    background-color: var(--bg-surface);
    cursor: pointer;
  }

  .preview-char:hover:not(:disabled):not([aria-pressed='true']) {
    border-color: var(--accent);
    background-color: var(--bg-inset);
  }

  .preview-char[aria-pressed='true'] {
    border-color: var(--accent-cta);
    background-color: var(--accent-cta);
    color: var(--on-accent);
  }

  .preview-control {
    min-height: var(--answer-target-min);
    white-space: normal;
  }

  .quiz-actions {
    display: grid;
    gap: var(--space-2);
  }

  .quiz-question,
  .audio-hint {
    margin: 0;
  }

  .audio-hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .sample-status :global(svg) {
    display: inline;
    vertical-align: middle;
  }

  .preview-char:disabled {
    cursor: default;
  }

  .sample-letter {
    font-family: var(--font-home);
    font-size: clamp(3.5rem, 8vw, 5rem);
    font-weight: 500;
    line-height: var(--leading-tight);
  }

  .sample-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .sample-status {
    min-height: calc(1em * var(--leading-normal));
    margin: 0;
  }

  .sample-error {
    margin: 0;
    color: var(--status-bad);
  }

  @media (max-width: 479px) {
    .preview-char {
      min-height: 8rem;
      padding-block: var(--space-4);
      gap: var(--space-2);
    }
  }
</style>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    ArrowRight,
    ChevronRight,
    CircleCheck,
    CircleX,
    Dumbbell,
    Info,
    LayoutDashboard,
    MessageSquare,
    Play,
    Square
  } from '@lucide/svelte';
  import { createWebAudioEngine, type AudioEngine } from '$lib/audio/engine';
  import { acceptsSessionShortcut } from '$lib/components/learning/keyboard';
  import { buildAudioPlan } from '$lib/training/timing';
  import { localizedHref as href } from '$lib/i18n.svelte';
  import { getLessonCharacterSet } from '$lib/training/sequence';
  import { GITHUB_URL } from '$lib/seo';
  import * as m from '$lib/paraglide/messages';

  // The lists store the message functions, not their values, so the template
  // always reads the current locale (the layout also remounts on a switch).
  const steps = [
    { title: m.home_step1_title, body: m.home_step1_body },
    { title: m.home_step2_title, body: m.home_step2_body },
    { title: m.home_step3_title, body: m.home_step3_body }
  ];

  const destinations = [
    { path: '/morse/practice', title: m.nav_practice, body: m.home_go_practice, icon: Dumbbell },
    {
      path: '/morse/progress',
      title: m.nav_progress,
      body: m.home_go_progress,
      icon: LayoutDashboard
    },
    { path: '/forum', title: m.nav_forum, body: m.home_go_forum, icon: MessageSquare },
    { path: '/about', title: m.nav_about, body: m.home_go_about, icon: Info }
  ];

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

<section class="masthead" aria-labelledby="home-title">
  <div class="masthead-copy">
    <h1 id="home-title" class="masthead-title">{m.home_hero_title()}</h1>
    <p class="masthead-lede">{m.home_hero_subtitle()}</p>
    <div class="masthead-actions">
      <a href={href('/morse/learn/session?step=1')} class="btn-cta">{m.home_cta()}</a>
      <a href={href('/morse/practice')} class="link practice-link">{m.home_hero_cta_secondary()}</a>
    </div>
    <p class="body-text reassurance">
      {m.home_reassurance()}
    </p>
  </div>
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
          {#if quizAnswer}<button
              type="button"
              class="btn-ghost preview-control"
              onclick={startQuiz}>{m.home_quiz_again()}</button
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
                {:else if heardCharacters.includes(char)}<CircleCheck
                    size={16}
                    aria-hidden="true"
                  />
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
</section>

<div class="learning-intro">
  <section class="method" aria-labelledby="home-method-title">
    <div class="method-heading">
      <h2 id="home-method-title" class="section-title">{m.home_steps_title()}</h2>
      <p class="body-text method-intro">{m.home_preview_caption()}</p>
    </div>
    <ol class="step-list">
      {#each steps as step, index (step.title)}
        <li class="step">
          <span class="step-number" aria-hidden="true">{index + 1}</span>
          <div>
            <strong class="step-title">{step.title()}</strong>
            <p class="body-text">{step.body()}</p>
          </div>
        </li>
      {/each}
    </ol>
  </section>
</div>

<!-- Destinations: a plain list of where the product continues. -->
<section class="destinations" aria-labelledby="home-destinations-title">
  <div class="destinations-copy">
    <h2 id="home-destinations-title" class="section-title">{m.home_go_title()}</h2>
    <ul class="row-list">
      {#each destinations as destination (destination.path)}
        <li>
          <a class="row-link dest-row" href={href(destination.path)}>
            <span class="dest-icon"><destination.icon size={22} aria-hidden="true" /></span>
            <span class="dest-copy">
              <span class="dest-title">{destination.title()}</span>
              <span class="dest-body">{destination.body()}</span>
            </span>
            <ChevronRight size={18} class="dest-chevron" aria-hidden="true" />
          </a>
        </li>
      {/each}
    </ul>
  </div>
</section>

<!-- Who builds it. -->
<section class="colophon">
  <p class="body-text">{m.home_author_line()}</p>
  <div class="colophon-links">
    <a href={href('/about')} class="link">{m.home_author_link()}</a>
    <a href={GITHUB_URL} class="link" rel="noopener noreferrer" target="_blank"
      >{m.home_author_github()}</a
    >
  </div>
</section>

<style>
  .learning-intro,
  .destinations,
  .colophon {
    --home-section-gap: calc(var(--space-6) * 2);
    font-family: var(--font-home);
  }

  .masthead {
    display: grid;
    align-items: center;
    gap: var(--space-8);
    font-family: var(--font-home);
  }

  .masthead-preview {
    min-width: 0;
  }

  .masthead-copy {
    min-width: 0;
    max-width: 36rem;
    text-align: left;
  }

  .masthead-title {
    margin: 0;
    max-width: 18ch;
    font-size: clamp(2.125rem, 4.5vw, 3.25rem);
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: -0.025em;
    color: var(--text-primary);
    text-wrap: balance;
  }

  .masthead-lede {
    max-width: 42ch;
    margin: var(--space-5) 0 var(--space-6);
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--text-secondary);
    text-wrap: pretty;
  }

  .masthead-actions {
    display: grid;
    justify-items: start;
    gap: var(--space-1);
  }

  .masthead-actions :global(a) {
    min-height: var(--answer-target-min);
  }

  .practice-link {
    font-size: var(--text-base);
    display: inline-flex;
    align-items: center;
    text-decoration: underline;
    text-underline-offset: var(--space-1);
  }

  .reassurance {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .learning-intro {
    margin-top: var(--home-section-gap);
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
    min-height: 10rem;
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
    min-height: calc(2em * var(--leading-normal));
    margin: 0;
  }

  .sample-error {
    margin: 0;
    color: var(--status-bad);
  }

  .method {
    min-width: 0;
    display: grid;
    gap: var(--space-6);
    padding-top: var(--space-8);
    border-top: 1px solid var(--border);
  }

  .method .step-number {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-home);
    font-size: var(--text-xl);
  }

  .section-title {
    margin-bottom: var(--space-6);
    padding: 0;
    border: 0;
    font-family: var(--font-home);
    font-size: var(--text-2xl);
    font-weight: 500;
    text-wrap: balance;
  }

  .method .step-list {
    display: grid;
    gap: var(--space-6);
    margin: 0;
  }

  .method-intro {
    margin: calc(var(--space-4) * -1) 0 var(--space-6);
    font-size: var(--text-base);
  }

  .step .body-text {
    margin: var(--space-1) 0 0;
    max-width: 48ch;
    font-size: var(--text-base);
  }

  .destinations {
    margin-top: var(--home-section-gap);
  }

  .destinations-copy {
    min-width: 0;
  }

  .destinations li {
    display: grid;
  }

  .dest-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    min-height: 7rem;
    padding: var(--space-5) var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .dest-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--answer-target-min);
    height: var(--answer-target-min);
    border-radius: var(--radius-md);
    background-color: var(--bg-inset);
    color: var(--accent);
  }

  .dest-copy {
    display: grid;
    gap: var(--space-1);
  }

  .dest-row :global(.dest-chevron) {
    color: var(--text-muted);
  }

  .dest-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .dest-body {
    max-width: 32rem;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .colophon {
    margin-top: var(--home-section-gap);
    padding-top: var(--space-8);
    border-top: 1px solid var(--border);
  }

  .colophon :global(.body-text) {
    margin: 0;
    max-width: 60ch;
    font-size: var(--text-base);
  }

  .colophon-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-top: var(--space-2);
  }

  .colophon-links :global(a) {
    display: inline-flex;
    align-items: center;
    min-height: var(--answer-target-min);
  }

  @media (max-width: 479px) {
    .masthead {
      gap: var(--space-6);
    }

    .masthead-lede {
      margin: var(--space-3) 0 var(--space-4);
      font-size: var(--text-base);
      line-height: var(--leading-normal);
    }

    .preview-char {
      min-height: 8rem;
      padding-block: var(--space-4);
      gap: var(--space-2);
    }

    .masthead-actions {
      justify-items: stretch;
    }

    .practice-link {
      justify-content: center;
    }
  }

  @media (min-width: 800px) {
    .masthead {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-10);
    }

    .learning-intro,
    .destinations,
    .colophon {
      --home-section-gap: calc(var(--space-6) * 2);
    }

    .method {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-10);
    }

    .destinations .row-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: var(--space-8);
    }
  }
</style>

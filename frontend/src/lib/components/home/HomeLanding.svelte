<script lang="ts">
  import HomePreview from '#lib/components/home/HomePreview.svelte';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  // The lists store the message functions, not their values, so the template
  // always reads the current locale (the layout also remounts on a switch).
  const steps = [
    { title: m.home_step1_title, body: m.home_step1_body },
    { title: m.home_step2_title, body: m.home_step2_body },
    { title: m.home_step3_title, body: m.home_step3_body }
  ];
</script>

<section class="masthead" aria-labelledby="home-title">
  <div class="masthead-copy">
    <h1 id="home-title" class="masthead-title">{m.home_hero_title()}</h1>
    <p class="masthead-lede">{m.home_hero_subtitle()}</p>
  </div>
  <div class="listening-stage"><HomePreview /></div>
  <div class="masthead-entry">
    <div class="masthead-actions">
      <a href={href('/morse/learn/session?step=1')} class="btn-cta">{m.home_cta()}</a>
      <a href={href('/morse/learn')} class="link all-lessons">{m.home_all_lessons()}</a>
    </div>
    <p class="body-text reassurance">
      {m.home_reassurance()}
    </p>
    <a href={href('/morse/practice')} class="link practice-link">{m.home_hero_cta_secondary()}</a>
  </div>
</section>

<details class="method ui-disclosure">
  <summary>{m.home_method_details()}</summary>
  <p class="body-text method-intro">{m.home_preview_caption()}</p>
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
</details>

<style>
  .masthead {
    display: grid;
    grid-template-areas: 'intro' 'listening' 'entry';
    align-items: start;
    gap: var(--space-6);
    font-family: var(--font-home);
  }

  .masthead-copy {
    grid-area: intro;
    min-width: 0;
    max-width: 36rem;
    text-align: left;
  }

  .masthead-title {
    margin: 0;
    max-width: 16ch;
    font-size: clamp(2.125rem, 4.5vw, 3.25rem);
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: -0.025em;
    color: var(--text-primary);
    text-wrap: balance;
  }

  .masthead-lede {
    max-width: 42ch;
    margin: var(--space-4) 0 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--text-secondary);
    text-wrap: pretty;
  }

  .listening-stage {
    grid-area: listening;
    min-width: 0;
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--bg-inset);
  }

  .masthead-entry {
    grid-area: entry;
    min-width: 0;
    max-width: 36rem;
  }

  .masthead-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }

  .masthead-actions :global(a) {
    min-height: var(--answer-target-min);
  }

  .all-lessons,
  .practice-link {
    font-size: var(--text-sm);
    display: inline-flex;
    align-items: center;
    text-decoration: underline;
    text-underline-offset: var(--space-1);
  }

  .masthead-actions .btn-cta {
    min-width: 0;
    white-space: normal;
    text-align: center;
  }

  .all-lessons {
    padding-inline: var(--space-2);
  }

  .practice-link {
    min-height: var(--answer-target-min);
    margin-top: var(--space-2);
    color: var(--text-secondary);
  }

  .practice-link:hover {
    color: var(--accent);
  }

  .reassurance {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .method {
    margin-top: var(--space-6);
    font-family: var(--font-home);
  }

  .method .step-number {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-home);
    font-size: var(--text-xl);
  }

  .method .step-list {
    display: grid;
    gap: var(--space-6);
    margin: var(--space-4) 0 0;
  }

  .method-intro {
    margin: 0;
    font-size: var(--text-base);
  }

  .step .body-text {
    margin: var(--space-1) 0 0;
    max-width: 48ch;
    font-size: var(--text-base);
  }

  @media (max-width: 479px) {
    .listening-stage {
      padding: var(--space-4);
    }

    .masthead-lede {
      margin: var(--space-3) 0 0;
      font-size: var(--text-base);
      line-height: var(--leading-normal);
    }
  }

  @media (min-width: 800px) {
    .masthead {
      grid-template-columns: 1fr 1.08fr;
      grid-template-areas: 'intro listening' 'entry listening';
      column-gap: var(--space-10);
    }

    .masthead-copy {
      align-self: end;
    }

    .listening-stage {
      align-self: center;
      padding: var(--space-8);
    }

    .method .step-list {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>

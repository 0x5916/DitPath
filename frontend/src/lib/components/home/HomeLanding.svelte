<script lang="ts">
  import { ChevronRight, Dumbbell, Info, LayoutDashboard, MessageSquare } from '@lucide/svelte';
  import HomePreview from '#lib/components/home/HomePreview.svelte';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import { GITHUB_URL } from '#lib/seo.ts';
  import * as m from '#lib/paraglide/messages.js';

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
</script>

<section class="masthead" aria-labelledby="home-title">
  <div class="masthead-copy">
    <h1 id="home-title" class="masthead-title">{m.home_hero_title()}</h1>
    <p class="masthead-lede">{m.home_hero_subtitle()}</p>
    <div class="masthead-actions">
      <a href={href('/morse/learn/session?step=1')} class="btn-cta">{m.home_cta()}</a>
      <a href={href('/morse/learn')} class="link practice-link">{m.nav_learn()}</a>
      <a href={href('/morse/practice')} class="link practice-link">{m.home_hero_cta_secondary()}</a>
    </div>
    <p class="body-text reassurance">
      {m.home_reassurance()}
    </p>
  </div>
  <HomePreview />
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

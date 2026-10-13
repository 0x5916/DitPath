<script lang="ts">
  import {
    ArrowRight,
    BookOpen,
    CircleCheck,
    ShieldCheck,
    UserRound,
    Wrench
  } from '@lucide/svelte';
  import { localizedHref as href } from '$lib/i18n.svelte';
  import { GITHUB_URL } from '$lib/seo';
  import * as m from '$lib/paraglide/messages';

  // The lists store the message functions, not their values, so the template
  // always reads the current locale (the layout also remounts on a switch).
  const toc = [
    { id: 'koch-method', label: m.about_koch_title },
    { id: 'the-project', label: m.about_project_title },
    { id: 'about-the-author', label: m.about_author_title },
    { id: 'your-data', label: m.about_privacy_title }
  ];

  const kochSteps = [
    { title: m.about_koch_step1_title, body: m.about_koch_step1_body },
    { title: m.about_koch_step2_title, body: m.about_koch_step2_body },
    { title: m.about_koch_step3_title, body: m.about_koch_step3_body },
    { title: m.about_koch_step4_title, body: m.about_koch_step4_body }
  ];
</script>

<div class="about-page page-narrow">
  <header class="about-header">
    <h1 class="page-title">{m.about_title()}</h1>
    <p class="body-text body-text--prose about-intro">{m.about_intro()}</p>
  </header>

  <nav class="about-toc" aria-label={m.about_toc_label()}>
    <span class="card-label about-toc-label">{m.about_toc_label()}</span>
    <ul class="about-toc-list">
      {#each toc as item (item.id)}
        <li><a class="link" href={`#${item.id}`}>{item.label()}</a></li>
      {/each}
    </ul>
  </nav>

  <!-- Koch method -->
  <section class="about-section" id="koch-method">
    <div class="about-section-icon" aria-hidden="true">
      <BookOpen size={20} />
    </div>
    <h2 class="section-title">{m.about_koch_title()}</h2>
    <p class="body-text body-text--prose about-intro">{m.about_koch_intro()}</p>

    <!-- How it works -->
    <h3 class="sub-title">{m.about_koch_how_title()}</h3>
    <ol class="step-list">
      {#each kochSteps as item, index (item.title)}
        <li class="step">
          <span class="step-number">{index + 1}</span>
          <div>
            <strong class="step-title">{item.title()}</strong>
            <p class="body-text">{item.body()}</p>
          </div>
        </li>
      {/each}
    </ol>

    <!-- Why it works -->
    <h3 class="sub-title">{m.about_koch_why_title()}</h3>
    <p class="body-text body-text--prose">{m.about_koch_why_body()}</p>

    <!-- Comparison -->
    <h3 class="sub-title">{m.about_koch_vs_title()}</h3>
    <div class="compare">
      <div class="compare-col compare-col--bad">
        <p class="panel-label compare-head">{m.about_koch_vs_traditional_label()}</p>
        <p class="body-text">{m.about_koch_vs_traditional_body()}</p>
      </div>
      <div class="compare-col compare-col--good">
        <p class="panel-label compare-head">
          <CircleCheck size={15} aria-hidden="true" />
          <span>{m.about_koch_vs_koch_label()}</span>
        </p>
        <p class="body-text">{m.about_koch_vs_koch_body()}</p>
      </div>
    </div>
  </section>

  <!-- The project -->
  <section class="about-section" id="the-project">
    <div class="about-section-icon" aria-hidden="true"><Wrench size={20} /></div>
    <h2 class="section-title">{m.about_project_title()}</h2>
    <p class="body-text body-text--prose">{m.about_project_body()}</p>
    <p class="body-text about-links">
      <a href={GITHUB_URL} class="link" rel="noopener noreferrer" target="_blank"
        >{m.about_project_github()}</a
      >
    </p>
  </section>

  <!-- About the author -->
  <section class="about-section" id="about-the-author">
    <div class="about-section-icon" aria-hidden="true"><UserRound size={20} /></div>
    <h2 class="section-title">{m.about_author_title()}</h2>
    <p class="body-text body-text--prose">{m.about_author_p1()}</p>
    <p class="body-text body-text--prose">
      {m.about_author_p2_pre()}
      <a href={GITHUB_URL} class="link" rel="noopener noreferrer" target="_blank"
        >{m.about_author_github()}</a
      >.
    </p>
  </section>

  <!-- Your data -->
  <section class="about-section" id="your-data">
    <div class="about-section-icon" aria-hidden="true"><ShieldCheck size={20} /></div>
    <h2 class="section-title">{m.about_privacy_title()}</h2>
    <p class="body-text body-text--prose">{m.about_privacy_body()}</p>
  </section>

  <div class="about-cta">
    <a href={href('/morse/learn')} class="btn-cta"
      >{m.home_cta()}<ArrowRight size={18} aria-hidden="true" /></a
    >
  </div>
</div>

<style>
  /* Width and vertical gaps come from `.page-narrow` and the shell; this page
     owns only the article's internal rhythm. */
  .about-intro {
    margin: var(--space-2) 0 0;
  }

  .about-toc {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .about-toc-label {
    margin-bottom: 0;
  }

  /* Four short labels: two fixed columns so a label never breaks mid-phrase,
     collapsing to one per row on phones where a two-up row would crowd the
     targets. */
  .about-toc-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    /* The row gap has to clear the expanded targets below, or neighbouring rows
       overlap and a tap landing between them is ambiguous. */
    gap: 0.6rem 1.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  /* Section links are bare text a single line tall. Padding grows the tap area
     and the negative margin keeps the links aligned with the list. */
  .about-toc-list li a {
    padding: 0.25rem 0.375rem;
    margin: -0.25rem -0.375rem;
  }

  /* Long-form, sequential content: no card chrome. Article rhythm + rules read
     better here than a stack of independent tiles. */
  .about-section {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-top: var(--section-gap);
    /* Keep anchored sections clear of the sticky navbar. */
    scroll-margin-top: 4.5rem;
  }

  /* The TOC is part of the page's opening, not a section of the article, so it
     closes at the block rhythm. `--section-gap` here left the first section
     floating away from the links that point into it. */
  .about-toc + .about-section {
    margin-top: var(--block-gap);
  }

  .about-section-icon {
    display: flex;
    color: var(--accent);
    margin-bottom: 0.5rem;
  }

  .about-section-icon :global(svg) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .about-links {
    margin-top: var(--space-3);
  }

  /* This paragraph holds the link alone rather than inline in a sentence, so it
     gets a real target instead of relying on the inline-text exception. */
  .about-links .link {
    padding: 0.25rem 0.375rem;
    margin: -0.25rem -0.375rem;
  }

  /* Two-peer comparison: one container, one shared edge, tinted columns. */
  .compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-top: var(--space-3);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .compare-col {
    padding: var(--space-4);
  }

  .compare-col + .compare-col {
    border-left: 1px solid var(--border-card);
  }

  .compare-col--bad {
    background-color: var(--result-bad-bg);
  }

  .compare-col--good {
    background-color: var(--result-good-bg);
  }

  .compare-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
  }

  .about-cta {
    margin-top: var(--section-gap);
    display: flex;
    justify-content: center;
  }

  @media (max-width: 480px) {
    .about-toc-list {
      grid-template-columns: 1fr;
    }

    .compare {
      grid-template-columns: 1fr;
    }

    .compare-col + .compare-col {
      border-left: none;
      border-top: 1px solid var(--border-card);
    }
  }

  /* Below the navbar breakpoint the top bar is `display: none`, so the desktop
     4.5rem clearance only parks the target below a hole of empty page. */
  @media (max-width: 639px) {
    .about-section {
      scroll-margin-top: var(--space-4);
    }
  }
</style>

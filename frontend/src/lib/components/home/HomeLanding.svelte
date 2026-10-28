<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';
  import HomePreview from '#lib/components/home/HomePreview.svelte';
  import WelcomeIllustration from './WelcomeIllustration.svelte';
  import { lang, setLangPreference, localizedHref as href, type Locale } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  let demoOpen = $state(false);
  const languages: { value: Locale; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
    { value: 'ja', label: '日本語' },
    { value: 'zh-Hans', label: '简体中文' },
    { value: 'zh-Hant', label: '繁體中文' }
  ];
  const steps = [
    { title: m.home_step1_title, body: m.home_step1_body },
    { title: m.home_step2_title, body: m.home_step2_body },
    { title: m.home_step3_title, body: m.home_step3_body }
  ];
</script>

<div class="welcome">
  <header class="welcome-header">
    <a class="wordmark" href={href('/')} aria-label="OpenCW">OpenCW</a>
    <div class="header-actions">
      <select
        aria-label={m.settings_language_label()}
        value={lang.value}
        onchange={(event) => setLangPreference(event.currentTarget.value as Locale)}
      >
        {#each languages as language (language.value)}<option value={language.value}
            >{language.label}</option
          >{/each}
      </select>
      <a class="header-login" href={href('/login')}>{m.welcome_sign_in()}</a>
    </div>
  </header>

  <section class="welcome-hero" aria-labelledby="home-title">
    <div class="welcome-art"><WelcomeIllustration /></div>
    <div class="welcome-copy">
      <h1 id="home-title">{m.home_hero_title()}</h1>
      <p class="welcome-lede">{m.home_hero_subtitle()}</p>
      <div class="welcome-actions">
        <a href={href('/morse/learn/session?step=1')} class="btn-cta">{m.welcome_start()}</a>
        <a class="practice-link" href={href('/morse/practice')}
          >{m.home_hero_cta_secondary()}<ArrowRight size={16} aria-hidden="true" /></a
        >
        <p class="reassurance">{m.home_reassurance()}</p>
        <a class="phone-login" href={href('/login')}>{m.welcome_sign_in()}</a>
      </div>
    </div>
  </section>

  <section class="welcome-demo" aria-labelledby="welcome-demo-title">
    <div class="demo-intro">
      <h2 id="welcome-demo-title">{m.welcome_demo_title()}</h2>
      <p>{m.welcome_demo_description()}</p>
    </div>
    <details class="listening-disclosure" bind:open={demoOpen}>
      <summary
        >{demoOpen ? m.welcome_demo_close() : m.welcome_demo_open()}<ArrowRight
          size={16}
          aria-hidden="true"
        /></summary
      >
      {#if demoOpen}<div class="listening-stage"><HomePreview /></div>{/if}
    </details>
    <details class="method ui-disclosure">
      <summary>{m.home_method_details()}</summary>
      <p class="body-text">{m.home_preview_caption()}</p>
      <ol class="step-list">
        {#each steps as step, index (step.title)}
          <li class="step">
            <span class="step-number" aria-hidden="true">{index + 1}</span>
            <div>
              <strong>{step.title()}</strong>
              <p class="body-text">{step.body()}</p>
            </div>
          </li>
        {/each}
      </ol>
      <a class="all-lessons" href={href('/morse/learn')}
        >{m.home_all_lessons()}<ArrowRight size={16} aria-hidden="true" /></a
      >
    </details>
  </section>
  <footer class="welcome-footer">
    <span>OpenCW</span><a href={href('/about')}>{m.nav_about()}</a><a href={href('/more')}
      >{m.nav_more()}</a
    >
  </footer>
</div>

<style>
  .welcome {
    font-family: var(--font-ui);
  }
  .welcome-header,
  .header-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }
  .welcome-header {
    min-height: 3rem;
  }
  .wordmark {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--accent);
  }
  .welcome :where(a:not(.btn-cta)),
  select {
    min-height: 3rem;
    display: inline-flex;
    align-items: center;
  }
  .header-actions {
    gap: var(--space-8);
  }
  select {
    max-width: 9rem;
    border: 0;
    background: var(--bg-base);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .header-login,
  .phone-login {
    color: var(--accent);
    font-size: var(--text-sm);
  }
  .welcome-hero {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 6rem;
    min-height: 42.5rem;
    padding-block: var(--space-10);
  }
  .welcome-art {
    width: 100%;
    max-width: 30rem;
    align-self: start;
    margin-top: 4rem;
    justify-self: center;
  }
  .welcome-copy {
    min-width: 0;
  }
  h1 {
    max-width: 12ch;
    margin: 0;
    font-size: 3.25rem;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }
  .welcome-lede {
    max-width: 36ch;
    white-space: pre-line;
    margin: var(--space-6) 0 var(--space-10);
    font-size: var(--text-lg);
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .welcome-actions {
    display: grid;
    gap: var(--space-3);
    max-width: 24.5rem;
    text-align: center;
  }
  .welcome-actions .btn-cta {
    min-height: 3.25rem;
    white-space: normal;
    border-radius: var(--radius-lg);
  }
  .practice-link {
    justify-content: center;
    gap: var(--space-2);
    color: var(--accent);
    font-size: var(--text-sm);
  }
  .practice-link :global(svg) {
    flex-shrink: 0;
  }
  .reassurance {
    max-width: 30ch;
    justify-self: center;
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.4;
    color: var(--text-muted);
  }
  .welcome .phone-login {
    display: none;
  }
  .welcome-demo {
    display: grid;
    grid-template-columns: 1fr minmax(16rem, 23rem);
    align-items: center;
    gap: var(--space-6) var(--space-8);
    padding: var(--space-8);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: 1.625rem;
    font-weight: 600;
  }
  .demo-intro p {
    margin: 0;
    color: var(--text-secondary);
  }
  .listening-disclosure summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 3.25rem;
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-lg);
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  .listening-disclosure summary::-webkit-details-marker {
    display: none;
  }
  .listening-disclosure[open] {
    grid-column: 1 / -1;
  }
  .listening-stage {
    max-width: 36rem;
    margin: var(--space-6) auto 0;
  }
  .method {
    grid-column: 1 / -1;
  }
  .method .step-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
  }
  .step .body-text {
    margin-top: var(--space-2);
  }
  .all-lessons {
    gap: var(--space-2);
    color: var(--accent);
  }
  .welcome-footer {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    margin-top: var(--space-10);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  @media (max-width: 799px) {
    .wordmark {
      font-size: 1.5rem;
    }
    .welcome .header-login {
      display: none;
    }
    .welcome .phone-login {
      display: inline-flex;
      justify-content: center;
    }
    .welcome-hero {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-6);
      min-height: auto;
      padding-block: var(--space-10);
      text-align: center;
    }
    .welcome-art {
      max-width: 16.875rem;
      margin-top: 0;
    }
    .welcome-copy,
    .welcome-actions {
      width: 100%;
      max-width: 26rem;
      margin-inline: auto;
    }
    h1 {
      margin-inline: auto;
      font-size: 2.25rem;
    }
    .welcome-lede {
      margin: var(--space-4) auto var(--space-8);
      font-size: var(--text-base);
    }
    .welcome-demo {
      grid-template-columns: minmax(0, 1fr);
      padding: var(--space-4);
      gap: var(--space-5);
    }
    h2 {
      font-size: 1.25rem;
    }
    .method .step-list {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 799px) and (max-height: 700px) {
    .welcome-hero {
      padding-block: var(--space-4);
      gap: var(--space-3);
    }
    .welcome-art {
      max-width: 10.625rem;
    }
    h1 {
      font-size: 1.875rem;
    }
    .welcome-lede {
      font-size: var(--text-sm);
      margin-block: var(--space-3) var(--space-5);
    }
    .welcome-actions {
      gap: var(--space-2);
    }
  }
</style>

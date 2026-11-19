<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';
  import WelcomeIllustration from './WelcomeIllustration.svelte';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
</script>

<div class="welcome">
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
      </div>
    </div>
  </section>
</div>

<style>
  .welcome {
    font-family: var(--font-ui);
  }
  .welcome :where(a:not(.btn-cta)) {
    min-height: 3rem;
    display: inline-flex;
    align-items: center;
  }
  .welcome-hero {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 6rem;
    padding-block: var(--space-8);
  }
  .welcome-art {
    width: 100%;
    max-width: 30rem;
    align-self: start;
    margin-top: var(--space-6);
    justify-self: center;
  }
  .welcome-copy {
    min-width: 0;
  }
  h1 {
    max-width: 20ch;
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
  @media (max-width: 799px) {
    .welcome-hero {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
      padding-block: var(--space-3) var(--space-6);
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

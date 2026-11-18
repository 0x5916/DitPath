<script lang="ts">
  import { lang, setLangPreference, localizedHref as href } from '#lib/i18n.svelte.ts';
  import { getLocaleLongLabel } from '#lib/locale.ts';
  import { GITHUB_URL, SITE_NAME } from '#lib/seo.ts';
  import * as m from '#lib/paraglide/messages.js';

  let {
    variant,
    primaryLinks
  }: {
    variant: 'full' | 'minimal';
    primaryLinks: ReadonlyArray<{ path: string; label: () => string }>;
  } = $props();
  const languages = (['en', 'de', 'ja', 'zh-Hans', 'zh-Hant'] as const).map((value) => ({
    value,
    label: getLocaleLongLabel(value)
  }));
</script>

<footer
  class="site-footer"
  class:site-footer--full={variant === 'full'}
  class:site-footer--minimal={variant === 'minimal'}
>
  <div class="footer-inner">
    {#if variant === 'full'}
      <div class="footer-groups" style:--footer-rows={1 + Math.max(primaryLinks.length, 2)}>
        <nav aria-labelledby="footer-explore-title">
          <h2 id="footer-explore-title">{m.footer_explore()}</h2>
          <ul class="footer-links">
            {#each primaryLinks as item (item.path)}
              <li><a href={href(item.path)}>{item.label()}</a></li>
            {/each}
          </ul>
        </nav>
        <nav aria-labelledby="footer-project-title">
          <h2 id="footer-project-title">{SITE_NAME}</h2>
          <ul class="footer-links">
            <li><a href={href('/about')}>{m.nav_about()}</a></li>
            <li><a href={href('/more')}>{m.home_resources()}</a></li>
          </ul>
        </nav>
      </div>
      <div class="footer-language" role="group" aria-labelledby="footer-language-title">
        <h2 id="footer-language-title">{m.settings_language_label()}</h2>
        <div class="language-options">
          {#each languages as language (language.value)}
            <button
              type="button"
              lang={language.value}
              aria-pressed={lang.value === language.value}
              onclick={() => setLangPreference(language.value)}>{language.label}</button
            >
          {/each}
        </div>
      </div>
    {:else}
      <span>{SITE_NAME}</span>
      <div class="footer-minimal-links">
        <a href={href('/about')}>{m.nav_about()}</a>
        <a href={GITHUB_URL} rel="noopener noreferrer" target="_blank">{m.footer_link_github()}</a>
      </div>
    {/if}
  </div>
</footer>

<style>
  .site-footer {
    flex-shrink: 0;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .footer-inner {
    max-width: var(--max-width-container);
    margin-inline: auto;
    padding: var(--space-2) var(--space-4);
  }
  .site-footer--full .footer-inner {
    max-width: var(--max-width-wide);
    padding: var(--space-3) var(--space-6) calc(var(--space-3) + env(safe-area-inset-bottom));
  }
  .footer-groups {
    --footer-link-height: var(--space-8);
    display: grid;
    max-width: var(--max-width-narrow);
    margin-inline: auto;
    text-align: start;
    grid-template-columns: repeat(2, minmax(0, 10rem));
    justify-content: center;
    column-gap: var(--space-8);
  }
  /* A wrapped label grows the same row in both columns. */
  .footer-groups nav,
  .footer-links {
    display: grid;
    grid-template-rows: subgrid;
  }
  .footer-groups nav {
    grid-row: span var(--footer-rows);
    min-width: 0;
  }
  h2 {
    display: block;
    margin: 0;
    color: var(--text-primary);
    font-size: inherit;
    font-weight: 600;
    line-height: var(--leading-snug);
  }
  .footer-links {
    grid-row: 2 / -1;
    list-style: none;
    line-height: var(--leading-snug);
    padding: 0;
    margin: 0;
  }
  .footer-links li {
    display: grid;
    align-items: center;
    justify-items: start;
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: var(--footer-link-height, var(--nav-control-height));
    min-width: var(--nav-control-height);
    max-width: 100%;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  a:hover {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  .footer-language,
  .language-options {
    display: flex;
    align-items: center;
  }
  .footer-language {
    flex-direction: column;
    margin-block-start: var(--space-1);
    padding-block-start: var(--space-2);
    border-block-start: 1px solid var(--border);
  }
  .language-options {
    flex-wrap: wrap;
    justify-content: center;
    column-gap: var(--space-3);
  }
  .language-options button {
    min-height: var(--space-8);
    min-width: var(--nav-control-height);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .language-options button:hover,
  .language-options button[aria-pressed='true'] {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .language-options button[aria-pressed='true'] {
    font-weight: 600;
  }
  .language-options button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .site-footer--minimal .footer-inner,
  .footer-minimal-links {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
  }
  .site-footer--minimal .footer-inner {
    justify-content: space-between;
  }
  @media (min-width: 960px) and (hover: hover) and (pointer: fine) and (not (any-pointer: coarse)) {
    .site-footer--minimal {
      --footer-link-height: var(--space-8);
    }
  }
  @media (min-width: 640px) and (max-width: 1199px) {
    .site-footer--full .footer-inner {
      padding-inline: var(--space-4);
    }
  }
  @media (width < 960px) {
    /* Internal pages already provide the persistent bottom navigation. */
    .site-footer--minimal {
      display: none;
    }
  }
  @media (max-width: 639px) {
    .footer-groups {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
      column-gap: var(--space-4);
    }
  }
</style>

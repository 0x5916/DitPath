<script lang="ts">
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  let { current }: { current: 'learn' | 'practice' | 'tools' } = $props();

  const sections = [
    { id: 'learn', path: '/morse/learn', label: m.nav_learn },
    { id: 'practice', path: '/morse/practice', label: m.nav_practice },
    { id: 'tools', path: '/morse', label: m.morse_title }
  ];
</script>

<nav class="morse-section-nav" aria-label={m.nav_morse_sections()}>
  <ul>
    {#each sections as section (section.id)}
      <li>
        <a
          href={localizedHref(section.path)}
          aria-current={current === section.id ? 'page' : undefined}
        >
          {section.label()}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a {
    display: inline-flex;
    align-items: center;
    min-width: 44px;
    min-height: var(--answer-target-min);
    padding: var(--space-2) var(--space-1);
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: var(--leading-normal);
    text-decoration: none;
  }

  a:hover,
  a[aria-current='page'] {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }

  a:focus-visible {
    outline: 2px solid transparent;
    outline-offset: 2px;
    box-shadow: var(--focus-ring);
  }
</style>

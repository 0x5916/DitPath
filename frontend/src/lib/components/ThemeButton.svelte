<script lang="ts">
  import { Monitor, Moon, Sun } from '@lucide/svelte';
  import { setTheme, themePreference } from '#lib/theme.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  const modes = {
    auto: { icon: Monitor, label: m.theme_auto, next: 'light' },
    light: { icon: Sun, label: m.theme_light, next: 'dark' },
    dark: { icon: Moon, label: m.theme_dark, next: 'auto' }
  } as const;
  const current = $derived(modes[themePreference.value]);
  const action = $derived(
    m.nav_theme_switch({ current: current.label(), next: modes[current.next].label() })
  );
</script>

<button
  type="button"
  class="theme-icon-btn"
  aria-label={action}
  title={action}
  onclick={() => setTheme(current.next)}
>
  <span class="face" aria-hidden="true">
    {#each Object.entries(modes) as [value, mode] (value)}
      <span class="glyph" data-mode={value}><mode.icon size={20} /></span>
      <span class="label" data-mode={value}>{mode.label()}</span>
    {/each}
  </span>
</button>

<style>
  .face {
    display: grid;
    align-items: center;
    column-gap: var(--space-2);
  }
  .glyph {
    display: grid;
    grid-area: 1 / 1;
    opacity: 0;
    transform: rotate(-15deg);
  }
  /* Overlapping labels reserve the widest translated mode without moving the account control. */
  .label {
    grid-area: 1 / 2;
    text-align: start;
    visibility: hidden;
  }
  /* Both the icon and label match the applied preference before hydration. */
  :global(:root:not([data-theme])) [data-mode='auto'],
  :global(:root[data-theme='light']) [data-mode='light'],
  :global(:root[data-theme='dark']) [data-mode='dark'] {
    visibility: visible;
    opacity: 1;
    transform: rotate(0);
  }
  @media (prefers-reduced-motion: no-preference) {
    .glyph {
      transition:
        opacity 180ms ease,
        transform 180ms ease;
    }
  }
  @media (width < 960px) {
    .label {
      display: none;
    }
  }
</style>

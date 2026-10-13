<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    House,
    Info,
    Languages,
    LogIn,
    LogOut,
    MessageSquare,
    Monitor,
    Settings,
    User,
    UserPlus
  } from '@lucide/svelte';
  import { logout, user } from '$lib/auth';
  import { applyPageLanguagePreference } from '$lib/cwSync';
  import { localizedHref as href, setLangPreference, langPreference } from '$lib/i18n.svelte';
  import { getLocaleLongLabel } from '$lib/locale';
  import { locales } from '$lib/paraglide/runtime';
  import { readStoredTheme, setTheme, type Theme } from '$lib/theme';
  import * as m from '$lib/paraglide/messages';
  import type { LocalePreference } from '$lib/i18n.svelte';

  // Mirrors the `max-width: 639px` block in layout.css, where the top bar and the
  // tab bar hand over to each other.
  const DESKTOP_QUERY = '(min-width: 640px)';

  let theme = $state<Theme>('auto');
  let language = $state<LocalePreference>('auto');

  // Read the stored preferences on the client only, so the server-rendered
  // defaults hydrate cleanly.
  onMount(() => {
    theme = readStoredTheme();
    language = langPreference.value;
  });

  // This is a phone-only surface: on desktop every entry below already lives in
  // the top bar, so send the visitor to the settings page instead.
  $effect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      void goto(href('/settings'), { replaceState: true });
    }
  });

  // Theme is device-local, so it does not touch the synced page-settings timestamp.
  function changeTheme(next: Theme) {
    theme = setTheme(next);
  }

  function changeLanguage(next: LocalePreference) {
    language = next;
    applyPageLanguagePreference(next, setLangPreference);
  }

  async function handleLogout() {
    await logout();
    await goto(href('/'));
  }
</script>

<div class="page-narrow">
  <!-- Phone-only hub. The masthead matches the other pages (page-title only);
       the app mark lives in the top bar, which stays visible on this screen. -->
  <header class="more-heading">
    <h1 class="page-title">{m.nav_more()}</h1>
  </header>

  <section class="panel panel--ledger">
    <h2 class="card-title">{m.more_app_section()}</h2>
    <div class="more-list">
      <a href={href('/')} class="more-link"
        ><House size={16} aria-hidden="true" /><span class="more-link-text">{m.nav_home()}</span></a
      >
      <a href={href('/forum')} class="more-link"
        ><MessageSquare size={16} aria-hidden="true" /><span class="more-link-text"
          >{m.nav_forum()}</span
        ></a
      >
      <a href={href('/about')} class="more-link"
        ><Info size={16} aria-hidden="true" /><span class="more-link-text">{m.nav_about()}</span></a
      >
    </div>
  </section>

  <section class="panel panel--ledger">
    <h2 class="card-title">{m.settings_account_section()}</h2>
    <div class="more-list">
      <a href={href('/profile')} class="more-link"
        ><User size={16} aria-hidden="true" /><span class="more-link-text">{m.nav_profile()}</span
        ></a
      >
      <a href={href('/settings')} class="more-link"
        ><Settings size={16} aria-hidden="true" /><span class="more-link-text"
          >{m.nav_settings()}</span
        ></a
      >
      {#if $user}
        <button type="button" class="more-link" onclick={() => void handleLogout()}
          ><LogOut size={16} aria-hidden="true" /><span class="more-link-text"
            >{m.nav_logout()}</span
          ></button
        >
      {:else}
        <a href={href('/login')} class="more-link"
          ><LogIn size={16} aria-hidden="true" /><span class="more-link-text">{m.nav_login()}</span
          ></a
        >
        <a href={href('/register')} class="more-link"
          ><UserPlus size={16} aria-hidden="true" /><span class="more-link-text"
            >{m.nav_register()}</span
          ></a
        >
      {/if}
    </div>
  </section>

  <section class="panel panel--ledger">
    <h2 class="card-title">{m.settings_page_section()}</h2>
    <div class="more-list">
      <label class="more-link more-control">
        <Monitor size={16} aria-hidden="true" />
        <span class="more-link-text">{m.settings_theme_label()}</span>
        <select
          class="select more-select"
          value={theme}
          onchange={(e) => changeTheme(e.currentTarget.value as Theme)}
        >
          <option value="auto">{m.theme_auto()}</option>
          <option value="light">{m.theme_light()}</option>
          <option value="dark">{m.theme_dark()}</option>
        </select>
      </label>
      <label class="more-link more-control">
        <Languages size={16} aria-hidden="true" />
        <span class="more-link-text">{m.settings_language_label()}</span>
        <select
          class="select more-select"
          value={language}
          onchange={(e) => changeLanguage(e.currentTarget.value as LocalePreference)}
        >
          <option value="auto">{m.theme_auto()}</option>
          {#each locales as locale (locale)}
            <option value={locale}>{getLocaleLongLabel(locale)}</option>
          {/each}
        </select>
      </label>
    </div>
  </section>
</div>

<style>
  /* Same masthead rhythm as `.settings-heading`. */
  .more-heading {
    margin-bottom: var(--block-gap);
  }

  .more-list {
    display: flex;
    flex-direction: column;
    margin-top: var(--space-2);
  }

  /* Rows stay flat; section headings carry the only dividers. */
  .more-link {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: var(--space-3) 0;
    font-family: inherit;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    text-align: left;
    text-decoration: none;
    border: none;
    background: none;
    color: var(--text-primary);
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s;
  }

  .more-link:hover {
    color: var(--accent);
  }

  .more-link-text {
    flex: 1 1 auto;
  }

  .more-control {
    cursor: pointer;
    padding-block: 0.35rem;
  }

  .more-select {
    flex: 0 0 auto;
    width: max-content;
    max-width: none;
    min-height: 2rem;
    padding: var(--space-1) 1.75rem var(--space-1) var(--space-2);
    font-family: inherit;
    font-weight: inherit;
    text-align: right;
    text-align-last: right;
    border: none;
    background-color: transparent;
  }
</style>

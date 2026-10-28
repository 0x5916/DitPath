<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import '../app.css';
  import { user, initAuth, logout, getAuthSession } from '#lib/auth.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { AUTH_STORAGE_KEYS } from '#lib/storageKeys.ts';
  import { hasPendingTrainingPersistence } from '#lib/pending-training-persistence.ts';
  import { initializeTrainingSync, syncTrainingNow } from '#lib/training-sync.svelte.ts';
  import { initializeLearningSync } from '#lib/learning-sync.svelte.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import { reconcileSettingsWithServer } from '#lib/cwSync.ts';
  import { GITHUB_URL } from '#lib/seo.ts';
  import { goto, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import {
    Dumbbell,
    Ellipsis,
    House,
    LayoutDashboard,
    LogIn,
    LogOut,
    Settings,
    User,
    UserPlus
  } from '@lucide/svelte';
  import {
    lang,
    langPreference,
    setLangPreference,
    initLang,
    initializeBrowserLanguage,
    localizedHref as href
  } from '#lib/i18n.svelte.ts';
  import Dropdown from '#lib/components/Dropdown.svelte';
  import { applyTheme, readStoredTheme } from '#lib/theme.ts';
  import { navigationDestination } from '#lib/navigation.ts';
  import * as m from '#lib/paraglide/messages.js';

  let { children, data } = $props();

  const PRIMARY_NAV = [
    { path: '/morse/learn', label: m.nav_learn },
    { path: '/morse/practice', label: m.nav_practice },
    { path: '/morse/progress', label: m.nav_progress },
    { path: '/forum', label: m.nav_forum }
  ];
  const TAB_NAV = [
    { path: '/', label: m.nav_home, icon: House },
    { path: '/morse/practice', label: m.nav_practice, icon: Dumbbell },
    { path: '/morse/progress', label: m.nav_progress, icon: LayoutDashboard },
    { path: '/more', label: m.nav_more, icon: Ellipsis }
  ];
  let mobileSection = $derived(navigationDestination(page.route.id, true));
  let desktopSection = $derived(navigationDestination(page.route.id));
  let isTrainingSession = $derived(page.url.pathname.includes('/morse/learn/session'));

  const scope = createSessionScope();
  onDestroy(scope.dispose);
  let reconciledSettingsForSession = $state<number | null>(null);

  const structuredDataScripts = $derived(
    data.seo.structuredData.map((schema) => {
      // eslint-disable-next-line no-useless-escape -- Svelte ends script blocks at a literal closing script tag
      return `<script type="application/ld+json">${JSON.stringify(schema)}<\/script>`;
    })
  );

  // Preserve the URL's prerendered language through hydration. Device language
  // preferences only canonicalize bare URLs once the client router has mounted.
  // svelte-ignore state_referenced_locally
  initLang(data.locale, data.localePreference);

  $effect(() => {
    applyTheme(readStoredTheme());
    initAuth();
  });

  $effect(() => {
    if (!$user) {
      reconciledSettingsForSession = null;
      return;
    }

    const session = getAuthSession();
    if (reconciledSettingsForSession === session.generation) return;
    reconciledSettingsForSession = session.generation;
    const current = scope.capture();

    void reconcileSettingsWithServer({
      maxLesson: LESSONS.length,
      // A static build cannot read the stored preference while prerendering,
      // so fall back to the client-resolved one.
      fallbackLanguagePreference: langPreference.value,
      onLocale: (preference, options) => {
        if (current()) setLangPreference(preference, options);
      }
    }).catch(() => {
      // Keep app startup/login resilient if reconciliation fails.
    });
  });

  onMount(() => {
    const stopTraining = initializeTrainingSync();
    const stopLearning = initializeLearningSync();
    return () => {
      stopLearning();
      stopTraining();
    };
  });

  async function handleLogout() {
    const pending = logout();
    const current = scope.capture();
    await pending;
    if (current()) await goto(href('/'));
  }

  function handlePendingTrainingUnload(event: BeforeUnloadEvent) {
    if (hasPendingTrainingPersistence()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === null || Object.values(AUTH_STORAGE_KEYS).some((key) => key === event.key)) {
      initAuth();
    }
  }

  function stripTrailingSlash(path: string): string {
    return path.replace(/\/+$/, '') || '/';
  }

  // Active state matches the route and everything beneath it, so a thread
  // (/forum/<id>) keeps the Forum entry lit. The root path stays exact-match so
  // the brand link is not flagged as current on every page.
  function isActive(path: string): boolean {
    const current = stripTrailingSlash(page.url.pathname);
    const target = stripTrailingSlash(href(path));
    if (path === '/' || path === '/morse') return current === target;
    return current === target || current.startsWith(`${target}/`);
  }

  // Only text-entry controls open a soft keyboard; sliders and pickers leave
  // the phone navigation available.
  function usesTextKeyboard(target: EventTarget | null): boolean {
    return (
      (target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement &&
          ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type))) &&
      !target.readOnly &&
      !target.disabled
    );
  }

  function onDocumentFocusIn(event: FocusEvent) {
    document.body.classList.toggle('keyboard-open', usesTextKeyboard(event.target));
  }

  function onDocumentFocusOut(event: FocusEvent) {
    if (usesTextKeyboard(event.target)) {
      document.body.classList.remove('keyboard-open');
    }
  }

  afterNavigate(() => {
    void initializeBrowserLanguage().catch(() => {
      // A failed optional canonical navigation must not interrupt app startup.
    });
    void syncTrainingNow();
  });

  $effect(() => {
    if (typeof document === 'undefined') return;

    document.addEventListener('focusin', onDocumentFocusIn);
    document.addEventListener('focusout', onDocumentFocusOut);

    return () => {
      document.removeEventListener('focusin', onDocumentFocusIn);
      document.removeEventListener('focusout', onDocumentFocusOut);
    };
  });
</script>

<svelte:window onstorage={handleStorage} onbeforeunload={handlePendingTrainingUnload} />

<svelte:head>
  <title>{data.seo.title}</title>
  <meta name="description" content={data.seo.description} />
  <meta name="robots" content={data.seo.robots} />
  <link rel="canonical" href={data.seo.canonicalUrl} />
  {#each data.seo.alternates as alternate (alternate.locale)}
    <link rel="alternate" hreflang={alternate.locale} href={alternate.href} />
  {/each}
  <link rel="alternate" hreflang="x-default" href={data.seo.xDefaultHref} />
  <meta property="og:site_name" content={data.seo.siteName} />
  <meta property="og:type" content={data.seo.ogType} />
  <meta property="og:title" content={data.seo.title} />
  <meta property="og:description" content={data.seo.description} />
  <meta property="og:url" content={data.seo.canonicalUrl} />
  <meta property="og:locale" content={data.seo.openGraphLocale} />
  <meta property="og:image" content={data.seo.openGraphImage} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={data.seo.title} />
  <meta name="twitter:description" content={data.seo.description} />
  <meta name="twitter:image" content={data.seo.openGraphImage} />
  {#each structuredDataScripts as scriptTag (scriptTag)}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- server-built JSON-LD, no user input -->
    {@html scriptTag}
  {/each}
</svelte:head>

<div class="page-wrapper">
  {#if !isTrainingSession}
    <a class="skip-link" href="#main-content">{m.nav_skip_to_content()}</a>
    <nav class="navbar" aria-label={m.nav_primary()}>
      <div class="navbar-inner">
        <!-- Brand -->
        <!-- Brand is the home affordance, so "Home" is not duplicated in the links -->
        <a
          href={href('/')}
          class="navbar-brand"
          title={m.nav_home()}
          aria-current={isActive('/') ? 'page' : undefined}
        >
          <!-- The wordmark next to it already names the link. -->
          <span class="navbar-mark" aria-hidden="true"></span>
          OpenCW
        </a>

        <!-- Desktop: all links + user menu on the right -->
        <div class="navbar-right navbar-desktop">
          {#each PRIMARY_NAV as item (item.path)}
            <a
              href={href(item.path)}
              class="navbar-link"
              class:active={desktopSection === item.path}
              aria-current={desktopSection === item.path
                ? page.route.id === item.path
                  ? 'page'
                  : 'location'
                : undefined}>{item.label()}</a
            >
          {/each}
          {#if $user}
            <Dropdown id="user-menu" label={$user.username}>
              {#snippet trigger()}
                <User class="nav-icon" aria-hidden="true" />
                <span class="nav-account-label">{$user.username}</span>
              {/snippet}
              {#snippet menu()}
                <a href={href('/profile')} class="user-dropdown-item" role="menuitem"
                  ><LayoutDashboard size={14} /> {m.nav_profile()}</a
                >
                <a href={href('/settings')} class="user-dropdown-item" role="menuitem"
                  ><Settings size={14} /> {m.nav_settings()}</a
                >
                <button
                  type="button"
                  onclick={() => void handleLogout()}
                  class="user-dropdown-item"
                  role="menuitem"><LogOut size={14} /> {m.nav_logout()}</button
                >
              {/snippet}
            </Dropdown>
          {:else}
            <Dropdown id="guest-menu" label={m.nav_guest()}>
              {#snippet trigger()}
                <User class="nav-icon" aria-hidden="true" />
                <span class="nav-account-label">{m.nav_guest()}</span>
              {/snippet}
              {#snippet menu()}
                <a href={href('/profile')} class="user-dropdown-item" role="menuitem"
                  ><LayoutDashboard size={14} /> {m.nav_profile()}</a
                >
                <a href={href('/settings')} class="user-dropdown-item" role="menuitem"
                  ><Settings size={14} /> {m.nav_settings()}</a
                >
                <a href={href('/login')} class="user-dropdown-item" role="menuitem"
                  ><LogIn size={14} /> {m.nav_login()}</a
                >
                <a href={href('/register')} class="user-dropdown-item" role="menuitem"
                  ><UserPlus size={14} /> {m.nav_register()}</a
                >
              {/snippet}
            </Dropdown>
          {/if}
        </div>
      </div>
    </nav>
  {/if}

  <main
    class="page-content"
    class:page-content--session={isTrainingSession}
    id="main-content"
    tabindex="-1"
  >
    {#key lang.value}
      {@render children()}
    {/key}
  </main>

  {#if !isTrainingSession}
    <footer class="footer">
      <span>{m.footer_text()}</span>
      <span class="footer-links">
        <a href={href('/about')} class="footer-link">{m.nav_about()}</a>
        <a href={GITHUB_URL} class="footer-link" rel="noopener noreferrer" target="_blank"
          >{m.footer_link_github()}</a
        >
      </span>
    </footer>

    <!-- Mobile: bottom navigation bar (hidden on desktop) -->
    <nav class="bottom-nav" aria-label={m.nav_primary()}>
      {#each TAB_NAV as item (item.path)}
        <a
          href={href(item.path)}
          class="bottom-nav-item"
          class:active={mobileSection === item.path}
          aria-current={mobileSection === item.path
            ? page.route.id === item.path
              ? 'page'
              : 'location'
            : undefined}
          ><item.icon size={20} class="bottom-nav-icon" aria-hidden="true" /><span
            class="bottom-nav-label">{item.label()}</span
          ></a
        >
      {/each}
    </nav>
  {/if}
</div>

<style>
  .page-content.page-content--session {
    padding: 0;
    max-width: 100%;
    margin: 0;
  }
</style>

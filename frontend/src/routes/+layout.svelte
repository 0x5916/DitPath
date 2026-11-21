<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import '../app.css';
  import { user, initAuth, logout, getAuthSession } from '#lib/auth.ts';
  import { AdminMailSession, setAdminMailSession } from '#lib/admin-mail.svelte.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { AUTH_STORAGE_KEYS, UI_STORAGE_KEYS } from '#lib/storageKeys.ts';
  import { hasPendingTrainingPersistence } from '#lib/pending-training-persistence.ts';
  import { initializeTrainingSync, syncTrainingNow } from '#lib/training-sync.svelte.ts';
  import { initializeLearningSync } from '#lib/learning-sync.svelte.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import { reconcileSettingsWithServer } from '#lib/cwSync.ts';
  import {
    DEFAULT_OG_IMAGE_ALT,
    DEFAULT_OG_IMAGE_HEIGHT,
    DEFAULT_OG_IMAGE_WIDTH,
    SITE_NAME
  } from '#lib/seo.ts';
  import { goto, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import {
    Dumbbell,
    Ellipsis,
    House,
    LogIn,
    LogOut,
    Menu,
    Settings,
    ShieldUser,
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
  import ThemeButton from '#lib/components/ThemeButton.svelte';
  import SiteFooter from '#lib/components/SiteFooter.svelte';
  import MigrationBanner from '#lib/components/migration/MigrationBanner.svelte';
  import { applyTheme, readStoredTheme } from '#lib/theme.svelte.ts';
  import { navigationDestination } from '#lib/navigation.ts';
  import { ProfileIcon, ProgressIcon } from '#lib/navigation-icons.ts';
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
    { path: '/morse/progress', label: m.nav_progress, icon: ProgressIcon },
    { path: '/more', label: m.nav_more, icon: Ellipsis }
  ];
  const isHome = $derived(page.route.id === '/' && page.status < 400);
  let mobileSection = $derived(navigationDestination(page.route.id, true));
  let desktopSection = $derived(navigationDestination(page.route.id));
  let isTrainingSession = $derived(page.route.id === '/morse/learn/session' && page.status < 400);
  const MIGRATION_BANNER_HIDDEN_ROUTES = new Set([
    '/morse/practice',
    '/settings',
    '/login',
    '/register'
  ]);
  let showMigrationBanner = $derived(
    !isTrainingSession && !MIGRATION_BANNER_HIDDEN_ROUTES.has(page.route.id ?? '')
  );

  const adminMail = setAdminMailSession(new AdminMailSession());
  onMount(() => adminMail.observe());
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
    applyTheme(readStoredTheme());
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
    if (event.key === null || event.key === UI_STORAGE_KEYS.theme) {
      applyTheme(readStoredTheme());
    }
    if (event.key === null || Object.values(AUTH_STORAGE_KEYS).some((key) => key === event.key)) {
      initAuth();
    }
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
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content={String(DEFAULT_OG_IMAGE_WIDTH)} />
  <meta property="og:image:height" content={String(DEFAULT_OG_IMAGE_HEIGHT)} />
  <meta property="og:image:alt" content={DEFAULT_OG_IMAGE_ALT} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={data.seo.title} />
  <meta name="twitter:description" content={data.seo.description} />
  <meta name="twitter:image" content={data.seo.openGraphImage} />
  <meta name="twitter:image:alt" content={DEFAULT_OG_IMAGE_ALT} />
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
          aria-current={isHome ? 'page' : undefined}
        >
          {SITE_NAME}
        </a>

        <!-- Main links follow the wordmark; one account control serves every width. -->
        <div class="navbar-links navbar-desktop">
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
        </div>
        <div class="navbar-tools">
          <div class="navbar-account">
            {#if $user}
              <Dropdown id="user-menu" label={$user.username}>
                {#snippet trigger()}
                  <span class="nav-account-label">{$user.username}</span>
                  <User class="nav-icon" aria-hidden="true" />
                {/snippet}
                {#snippet menu()}
                  <a href={href('/profile')} class="user-dropdown-item" role="menuitem"
                    ><ProfileIcon size={14} aria-hidden="true" /> {m.nav_profile()}</a
                  >
                  {#if adminMail.owner}
                    <a href={href('/admin')} class="user-dropdown-item" role="menuitem"
                      ><ShieldUser size={14} /> {m.admin_title()}</a
                    >
                  {/if}
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
                  <span class="nav-account-label">{m.nav_guest()}</span>
                  <User class="nav-icon" aria-hidden="true" />
                {/snippet}
                {#snippet menu()}
                  <a href={href('/profile')} class="user-dropdown-item" role="menuitem"
                    ><ProfileIcon size={14} aria-hidden="true" /> {m.nav_profile()}</a
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
          <ThemeButton />
          {#if isHome}
            <div class="navbar-mobile">
              <Dropdown id="product-menu" label={m.nav_menu()}>
                {#snippet trigger()}
                  <Menu class="nav-icon" aria-hidden="true" />
                {/snippet}
                {#snippet menu()}
                  {#each PRIMARY_NAV as item (item.path)}
                    <a href={href(item.path)} class="user-dropdown-item" role="menuitem"
                      >{item.label()}</a
                    >
                  {/each}
                {/snippet}
              </Dropdown>
            </div>
          {/if}
        </div>
      </div>
    </nav>
  {/if}

  <main
    class="page-content"
    class:page-content--session={isTrainingSession}
    class:page-content--home={isHome}
    id="main-content"
    tabindex="-1"
  >
    {#key lang.value}
      {#if showMigrationBanner}
        <MigrationBanner />
      {/if}
      {@render children()}
    {/key}
  </main>

  {#if !isTrainingSession}
    <SiteFooter variant={isHome ? 'full' : 'minimal'} primaryLinks={PRIMARY_NAV} />

    <!-- The compact shell uses bottom tabs for internal views, including the Home dashboard. -->
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

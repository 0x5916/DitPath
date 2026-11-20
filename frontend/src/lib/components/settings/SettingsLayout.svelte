<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ArrowLeft, ChevronRight } from '@lucide/svelte';
  import { onMount, type Snippet } from 'svelte';
  import * as m from '#lib/paraglide/messages.js';

  type SectionBody = Snippet<[detail: boolean]>;
  let {
    loaded,
    accountData,
    preferences,
    sound,
    sync,
    evidence,
    account,
    data,
    advanced,
    status
  }: {
    loaded: boolean;
    accountData: boolean;
    preferences: SectionBody;
    sound: SectionBody;
    sync: SectionBody;
    evidence: SectionBody;
    account: SectionBody;
    data: SectionBody;
    advanced: SectionBody;
    status: Snippet;
  } = $props();

  const sections = $derived([
    { id: 'preferences', label: m.settings_appearance_title(), body: preferences },
    ...(loaded ? [{ id: 'sound-defaults', label: m.settings_sound_defaults(), body: sound }] : []),
    { id: 'sync-storage', label: m.settings_sync_storage_title(), body: sync },
    { id: 'learning-evidence', label: m.learning_overview_heading(), body: evidence },
    ...(loaded ? [{ id: 'account', label: m.settings_account_section(), body: account }] : []),
    ...(accountData
      ? [{ id: 'account-data', label: m.settings_account_data_title(), body: data }]
      : []),
    ...(loaded
      ? [{ id: 'advanced-preferences', label: m.settings_advanced(), body: advanced }]
      : [])
  ]);

  const url = $derived(page.url);
  const directoryHref = $derived(url.pathname + url.search);
  const fragment = $derived(browser ? url.hash.slice(1) : '');
  const sectionId = $derived(fragment === 'device-recovery' ? 'sync-storage' : fragment);
  const selected = $derived(sections.some((section) => section.id === sectionId) ? sectionId : '');
  let desktop = $state(true);
  const detail = $derived(!desktop && !!selected);
  let content: HTMLDivElement;
  let index = $state<HTMLDivElement>();
  let active = $state('preferences');
  let lastRow = '';
  let listScroll: number | undefined;
  let jumpTarget: HTMLElement | null = null;
  let jumpPosition = 0;

  onMount(() => {
    const viewport = window.matchMedia('(min-width: 960px)');
    const resize = () => {
      desktop = viewport.matches;
    };
    resize();
    viewport.addEventListener('change', resize);
    return () => viewport.removeEventListener('change', resize);
  });

  function focusHeading(target: HTMLElement) {
    const heading = target.querySelector<HTMLElement>('h1, h2, h3, summary');
    if (heading) {
      if (heading.tagName !== 'SUMMARY') heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function alignJump(target: HTMLElement) {
    // Leave room for short final sections to reach the top of the desktop column.
    const existingRoom = parseFloat(getComputedStyle(content).paddingBlockEnd);
    const remaining =
      content.getBoundingClientRect().bottom - existingRoom - target.getBoundingClientRect().top;
    const offset = parseFloat(getComputedStyle(target).scrollMarginBlockStart);
    content.style.paddingBlockEnd =
      Math.max(0, Math.ceil(window.innerHeight - offset - remaining)) + 'px';
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    jumpPosition = window.scrollY;
  }

  function revealDesktop(id: string) {
    const target = document.getElementById(id);
    jumpTarget = target && content.contains(target) ? target : null;
    if (!jumpTarget) {
      content.style.removeProperty('padding-block-end');
      return;
    }
    if (jumpTarget instanceof HTMLDetailsElement) jumpTarget.open = true;
    alignJump(jumpTarget);
    focusHeading(jumpTarget);
  }

  function navigate(event: MouseEvent, id = '') {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (id === fragment) {
      if (desktop) revealDesktop(id);
      return;
    }
    if (!id && page.state.settingsDirectory?.section === fragment) {
      window.history.back();
      return;
    }
    // A direct link can come from another screen. Its return link always leads
    // to Settings; a section opened from this directory uses its history entry.
    const state =
      id && !desktop ? { settingsDirectory: { section: id, scrollY: window.scrollY } } : {};
    void goto(directoryHref + (id ? '#' + id : ''), {
      reset: false,
      replace: !id,
      state,
      persistState: !!state.settingsDirectory
    });
  }

  $effect(() => {
    if (desktop) return;
    const dest = selected;
    const id = fragment;
    const origin = page.state.settingsDirectory;
    content.style.removeProperty('padding-block-end');
    const frame = requestAnimationFrame(() => {
      if (dest) {
        lastRow = dest;
        listScroll = origin?.section === id ? origin.scrollY : undefined;
        const target = document.getElementById(id);
        if (!target) return;
        if (id === dest) window.scrollTo({ top: 0, behavior: 'instant' });
        else target.scrollIntoView({ block: 'start', behavior: 'instant' });
        focusHeading(target);
      } else if (lastRow) {
        const link = index?.querySelector<HTMLAnchorElement>(`a[href="#${lastRow}"]`);
        window.scrollTo({ top: listScroll ?? 0, behavior: 'instant' });
        link?.focus({ preventScroll: listScroll !== undefined });
        lastRow = '';
        listScroll = undefined;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!desktop) return;
    const id = fragment;
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((target): target is HTMLElement => !!target);
    if (!targets.length) return;
    let frame = 0;

    function readPosition() {
      frame = 0;
      const offset = parseFloat(getComputedStyle(targets[0]).scrollMarginBlockStart) + 2;
      const atBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (Math.abs(window.scrollY - jumpPosition) > 2) jumpTarget = null;
      let current = jumpTarget && targets.find((target) => target.contains(jumpTarget));
      if (!current) {
        current = targets[0];
        for (const target of targets) {
          if (target.getBoundingClientRect().top <= offset) current = target;
          else break;
        }
        if (atBottom) current = targets[targets.length - 1];
      }
      active = current.id;
    }
    function scheduleRead() {
      if (!frame) frame = requestAnimationFrame(readPosition);
    }
    function layoutChanged() {
      if (jumpTarget && Math.abs(window.scrollY - jumpPosition) <= 2) alignJump(jumpTarget);
      scheduleRead();
    }
    frame = requestAnimationFrame(() => {
      revealDesktop(id);
      readPosition();
    });
    const observer = new ResizeObserver(layoutChanged);
    observer.observe(content);
    window.addEventListener('scroll', scheduleRead, { passive: true });
    window.addEventListener('resize', layoutChanged);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', scheduleRead);
      window.removeEventListener('resize', layoutChanged);
      jumpTarget = null;
    };
  });
</script>

<div class="settings-layout" class:detail>
  {#if detail}
    <a
      class="settings-back"
      href={directoryHref}
      aria-label={m.settings_back_to_settings()}
      onclick={(event) => navigate(event)}
    >
      <ArrowLeft size={18} aria-hidden="true" />{m.settings_title()}
    </a>
  {:else}
    <div class="section-index" bind:this={index}>
      <h1 class="page-title">{m.settings_title()}</h1>
      <nav aria-label={m.settings_title()}>
        <div class="section-links">
          {#each sections as item (item.id)}
            <a
              href={'#' + item.id}
              aria-current={desktop && active === item.id ? 'location' : undefined}
              onclick={(event) => navigate(event, item.id)}
            >
              {item.label}<ChevronRight size={18} aria-hidden="true" />
            </a>
          {/each}
        </div>
      </nav>
    </div>
  {/if}
  <div class="settings-content" bind:this={content}>
    {#each sections as item (item.id)}
      {#if desktop || selected === item.id}{@render item.body(!desktop)}{/if}
    {/each}
  </div>
  {#if !loaded}<div class="directory-status">{@render status()}</div>{/if}
</div>

<style>
  .settings-layout {
    --settings-offset: calc(env(safe-area-inset-top) + var(--space-4));
    max-width: var(--max-width-narrow);
    margin-inline: auto;
  }
  .settings-back {
    display: inline-flex;
    align-items: center;
    min-height: var(--nav-control-height);
    gap: var(--space-2);
    margin-block-end: var(--space-3);
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: 600;
    text-decoration: none;
  }
  .section-links a {
    text-decoration: none;
  }
  .settings-content,
  .directory-status {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    transition-property: none;
  }
  .directory-status {
    gap: var(--space-3);
  }
  .settings-content > :global(*) {
    margin-block: 0;
  }
  .settings-content :global(section[id]),
  .settings-content :global(details[id]) {
    scroll-margin-block-start: var(--settings-offset);
  }
  @media (width < 960px) {
    .settings-layout:not(.detail) .settings-content {
      display: none;
    }
    .section-links {
      display: grid;
      margin-block-start: var(--space-6);
    }
    .section-links a {
      min-height: 4.1875rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      color: var(--text-primary);
      font-weight: 500;
      border-block-end: 1px solid var(--border);
    }
    .section-links a :global(svg) {
      flex: none;
      color: var(--text-secondary);
    }
    .section-links a:is(:hover, :focus-visible) {
      color: var(--accent);
    }
    .settings-content :global(.page-title) {
      margin-block-end: var(--space-4);
    }
    .directory-status {
      margin-block-start: var(--space-4);
    }
  }
  @media (min-width: 960px) {
    .settings-layout {
      --settings-offset: calc(env(safe-area-inset-top) + var(--navbar-min-height) + var(--space-4));
      display: grid;
      grid-template-columns: 14rem minmax(0, 1fr);
      gap: 3rem;
      max-width: var(--max-width-container);
    }
    .section-index {
      position: sticky;
      inset-block-start: var(--settings-offset);
      display: block;
      align-self: start;
      max-height: calc(100dvh - var(--settings-offset) - var(--space-4));
      overflow-y: auto;
      padding: var(--space-1);
      margin: calc(-1 * var(--space-1));
    }
    nav {
      position: static;
      margin: var(--space-6) 0 0;
      padding: 0;
    }
    .section-links {
      display: grid;
      gap: var(--space-1);
    }
    .section-links :global(svg) {
      display: none;
    }
    .directory-status {
      grid-column: 2;
    }
    .section-links a {
      display: flex;
      align-items: center;
      min-height: var(--nav-control-height);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
      text-decoration: none;
    }
    .section-links a:hover {
      background: var(--bg-inset);
      color: var(--text-primary);
    }
    .section-links a[aria-current] {
      background: color-mix(in srgb, var(--accent) 12%, var(--bg-base));
      box-shadow: inset 3px 0 var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
  }
</style>

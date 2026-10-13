<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { ChevronDown } from '@lucide/svelte';
  import { tick } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    /** id of the menu element, referenced by the trigger's aria-controls */
    id: string;
    /** optional accessible label for the trigger button */
    label?: string;
    /** trigger button content (icon + text; the chevron is added automatically) */
    trigger: Snippet;
    /** menu items (role="menuitem" is expected on each) */
    menu: Snippet;
  }

  let { id, label = '', trigger, menu }: Props = $props();

  let open = $state(false);
  let wrapperEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  let leaveTimer = 0;
  let openedByHover = false;

  function canHover(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches
    );
  }

  function menuItems(): HTMLElement[] {
    if (!menuEl) return [];
    return Array.from(menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  /**
   * Close the menu. `returnFocus` sends focus back to the trigger, which is
   * what a keyboard user expects after Escape.
   */
  function close(returnFocus = false) {
    const wasOpen = open;
    open = false;
    openedByHover = false;
    if (returnFocus && wasOpen) triggerEl?.focus();
  }

  async function focusMenuItem(position: 'first' | 'last') {
    await tick();
    const items = menuItems();
    for (const item of items) item.tabIndex = -1;
    const target = position === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
  }

  /**
   * Open the menu. `focus` decides where focus lands: 'none' for pointer/hover
   * opens, 'first'/'last' when a keyboard gesture opened it.
   */
  async function openMenu(focus: 'first' | 'last' | 'none' = 'none') {
    if (open) {
      if (focus !== 'none') await focusMenuItem(focus);
      return;
    }
    open = true;
    openedByHover = focus === 'none';
    await tick();
    const items = menuItems();
    // Roving tabindex: menu items are reached with the arrow keys, not Tab.
    for (const item of items) item.tabIndex = -1;
    if (focus === 'none') return;
    const target = focus === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
  }

  function toggle() {
    // A click directly after a hover-open should confirm the menu rather than
    // dismiss it (touch devices can fire mouseenter before click).
    if (open && openedByHover) {
      openedByHover = false;
      return;
    }
    if (open) close();
    else void openMenu('none');
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      void openMenu('last');
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const items = menuItems();
    if (items.length === 0) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const index = active ? items.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = index === -1 ? 0 : (index + 1) % items.length;
      items[next]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = index === -1 ? items.length - 1 : (index - 1 + items.length) % items.length;
      items[prev]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  }

  function onTriggerMouseEnter() {
    if (!canHover()) return;
    clearTimeout(leaveTimer);
    if (!open) void openMenu('none');
  }

  function onTriggerMouseLeave() {
    if (!canHover() || !open) return;
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => close(), 200);
  }

  function onMenuMouseEnter() {
    if (!canHover()) return;
    clearTimeout(leaveTimer);
  }

  function onMenuMouseLeave() {
    if (!canHover()) return;
    clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => close(), 200);
  }

  function onDocumentClick(event: MouseEvent) {
    const target = event.target;
    if (!open || !wrapperEl || !(target instanceof Node)) return;

    // Close on outside clicks and on menu-item clicks; the trigger itself is
    // excluded because its own click handler toggles the menu.
    if (!wrapperEl.contains(target) || !triggerEl?.contains(target)) close();
  }

  function onDocumentKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    const target = event.target;
    const inside = target instanceof Node && wrapperEl?.contains(target) === true;
    close(inside);
  }

  // Close on back/forward and client-side navigation.
  afterNavigate(() => close());

  $effect(() => {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);

    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeydown);
    };
  });
</script>

<div class="user-menu-wrapper" bind:this={wrapperEl}>
  <button
    type="button"
    bind:this={triggerEl}
    onclick={toggle}
    onkeydown={onTriggerKeydown}
    onmouseenter={onTriggerMouseEnter}
    onmouseleave={onTriggerMouseLeave}
    class="navbar-user-btn"
    aria-expanded={open}
    aria-haspopup="menu"
    aria-controls={open ? id : undefined}
    title={label || undefined}
    aria-label={label || undefined}
  >
    <span class="nav-label-icon">
      {@render trigger()}
      <ChevronDown class="nav-icon" aria-hidden="true" />
    </span>
  </button>
  {#if open}
    <div
      class="user-dropdown"
      {id}
      role="menu"
      tabindex="-1"
      aria-label={label || undefined}
      bind:this={menuEl}
      onkeydown={onMenuKeydown}
      onmouseenter={onMenuMouseEnter}
      onmouseleave={onMenuMouseLeave}
    >
      {@render menu()}
    </div>
  {/if}
</div>

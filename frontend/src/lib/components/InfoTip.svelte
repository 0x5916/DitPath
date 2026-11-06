<script lang="ts">
  import * as m from '#lib/paraglide/messages.js';
  import { placeFloatingPanel } from '#lib/floating-panel.ts';
  import { Info, X } from '@lucide/svelte';
  import { onMount, tick, type Snippet } from 'svelte';

  let {
    label,
    text,
    children,
    heading = false
  }: { label: string; text: string; children?: Snippet; heading?: boolean } = $props();
  const tooltipId = $props.id();
  let wrapper: HTMLSpanElement;
  let trigger: HTMLButtonElement;
  let panel = $state<HTMLSpanElement>();
  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let dismissed = $state(false);
  let left = $state(0);
  let top = $state(0);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const open = $derived(!dismissed && (hovered || focused || pinned));

  function dismiss() {
    pinned = false;
    dismissed = true;
  }

  function enter(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    clearTimeout(leaveTimer);
    hovered = true;
    dismissed = false;
  }

  function leave(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    leaveTimer = setTimeout(() => (hovered = false), 150);
  }

  function toggle() {
    if (pinned) dismiss();
    else {
      pinned = true;
      dismissed = false;
    }
  }

  function outside(event: PointerEvent) {
    if (open && event.target instanceof Node && !wrapper.contains(event.target)) dismiss();
  }

  function escape(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      if (heading && pinned && panel?.contains(document.activeElement)) trigger.focus();
      if (event.currentTarget === trigger) {
        event.preventDefault();
        event.stopPropagation();
      }
      dismiss();
    }
  }

  function position() {
    if (!open || !panel || !trigger) return;
    const bounds = panel.getBoundingClientRect();
    const placement = placeFloatingPanel({
      anchor: trigger.getBoundingClientRect(),
      panel: { width: bounds.width, height: bounds.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      gap: heading ? 8 : 4
    });
    if (!placement) return dismiss();
    left = placement.left;
    top = placement.top;
  }

  $effect(() => {
    if (open) void tick().then(position);
  });

  onMount(() => {
    const scroll = (event: Event) => {
      if (!open || event.target === panel) return;
      if (focused || pinned) position();
      else dismiss();
    };
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('scroll', scroll, true);
      clearTimeout(leaveTimer);
    };
  });
</script>

<svelte:document onpointerdown={outside} onkeydown={escape} />
<svelte:window onresize={dismiss} />

<span
  class="info-tip"
  class:heading
  bind:this={wrapper}
  onfocusout={(event) => {
    if (
      heading &&
      pinned &&
      event.relatedTarget instanceof Node &&
      !wrapper.contains(event.relatedTarget)
    )
      dismiss();
  }}
>
  <button
    type="button"
    class="tip-trigger"
    bind:this={trigger}
    aria-label={label}
    aria-describedby={open ? tooltipId : undefined}
    aria-expanded={open}
    onpointerenter={enter}
    onpointerleave={leave}
    onclick={toggle}
    onkeydown={(event) => {
      if (event.key === 'Tab' && !(heading && pinned)) dismiss();
      else escape(event);
    }}
    onfocus={() => {
      focused = true;
      dismissed = false;
    }}
    onblur={() => {
      focused = false;
      if (!heading) pinned = false;
    }}
  >
    {#if children}{@render children()}{:else}<Info
        size={heading ? 20 : 16}
        aria-hidden="true"
      />{/if}
  </button>
  {#if open}
    <span
      id={tooltipId}
      role={heading && pinned ? 'dialog' : 'tooltip'}
      aria-label={heading && pinned ? label : undefined}
      class="tip-panel"
      bind:this={panel}
      style:left={`${left}px`}
      style:top={`${top}px`}
      onpointerenter={enter}
      onpointerleave={leave}
    >
      {#if heading && pinned}
        <span class="tip-header">
          <strong class="tip-heading">{label}</strong>
          <button
            type="button"
            class="tip-close"
            aria-label={m.overlay_close()}
            title={m.overlay_close()}
            onclick={() => {
              trigger.focus();
              dismiss();
            }}><X size={18} aria-hidden="true" /></button
          >
        </span>
      {/if}
      <span class="tip-body">{text}</span>
    </span>
  {/if}
</span>

<style>
  .info-tip {
    display: inline-flex;
    flex-shrink: 0;
    vertical-align: middle;
  }

  .tip-trigger {
    display: inline-flex;
    flex-direction: var(--tip-trigger-direction, row);
    align-items: center;
    justify-content: center;
    gap: var(--tip-trigger-gap, 0);
    width: var(--tip-trigger-size, 44px);
    height: var(--tip-trigger-size, 44px);
    padding: 0;
    border: var(--tip-trigger-border, 0);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    background: var(--tip-trigger-background, transparent);
    cursor: pointer;
  }

  .heading .tip-trigger {
    justify-content: flex-start;
    padding-left: 6px;
  }
  .tip-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .tip-heading {
    color: var(--text-primary);
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.3;
  }
  .tip-close {
    display: inline-flex;
    flex: 0 0 48px;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    margin: -8px -8px 0 0;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .tip-close:hover {
    color: var(--accent);
  }
  .tip-close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .tip-body {
    display: block;
  }

  .tip-trigger:hover,
  .tip-trigger[aria-expanded='true'] {
    color: var(--accent);
  }

  .tip-trigger:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .tip-panel {
    position: fixed;
    z-index: 100;
    width: 20rem;
    max-width: calc(100vw - 2 * var(--space-4));
    max-height: calc(100dvh - 2 * var(--space-4));
    box-sizing: border-box;
    overflow: auto;
    overflow-wrap: anywhere;
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-secondary);
    box-shadow: var(--shadow-menu);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: normal;
    text-align: start;
    text-transform: none;
    user-select: text;
  }
</style>

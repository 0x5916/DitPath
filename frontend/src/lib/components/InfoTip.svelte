<script lang="ts">
  import { Info } from '@lucide/svelte';
  import { onMount, tick, type Snippet } from 'svelte';

  let { label, text, children }: { label: string; text: string; children?: Snippet } = $props();
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
      if (event.currentTarget === trigger) {
        event.preventDefault();
        event.stopPropagation();
      }
      dismiss();
    }
  }

  function position() {
    if (!open || !panel || !trigger) return;
    const anchor = trigger.getBoundingClientRect();
    if (
      anchor.bottom <= 0 ||
      anchor.top >= window.innerHeight ||
      anchor.right <= 0 ||
      anchor.left >= window.innerWidth
    )
      return dismiss();
    const bounds = panel.getBoundingClientRect();
    left = Math.max(16, Math.min(anchor.left, window.innerWidth - bounds.width - 16));
    top =
      anchor.bottom + bounds.height + 4 <= window.innerHeight - 16
        ? anchor.bottom + 4
        : Math.max(16, anchor.top - bounds.height - 4);
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

<span class="info-tip" bind:this={wrapper}>
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
      if (event.key === 'Tab') dismiss();
      else escape(event);
    }}
    onfocus={() => {
      focused = true;
      dismissed = false;
    }}
    onblur={() => {
      focused = false;
      pinned = false;
    }}
  >
    {#if children}{@render children()}{:else}<Info size={16} aria-hidden="true" />{/if}
  </button>
  {#if open}
    <span
      id={tooltipId}
      role="tooltip"
      class="tip-panel"
      bind:this={panel}
      style:left={`${left}px`}
      style:top={`${top}px`}
      onpointerenter={enter}
      onpointerleave={leave}>{text}</span
    >
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

<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  interface Props {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    returnFocusTo?: HTMLElement | null;
    fallbackFocus?: HTMLElement | null;
  }

  let {
    isOpen = false,
    onConfirm = () => {},
    onCancel = () => {},
    returnFocusTo = null,
    fallbackFocus = null
  }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialogEl) return;
    if (isOpen && !dialogEl.open) {
      dialogEl.showModal();
    } else if (!isOpen && dialogEl.open) {
      dialogEl.close();
      (returnFocusTo?.isConnected ? returnFocusTo : fallbackFocus)?.focus();
    }
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target !== dialogEl || !dialogEl) return;
    const { left, right, top, bottom } = dialogEl.getBoundingClientRect();
    if (
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom
    )
      onCancel();
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key !== 'Tab' || !dialogEl) return;
    const buttons = dialogEl.querySelectorAll<HTMLButtonElement>('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = dialogEl.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || active === dialogEl)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (active === last || active === dialogEl)) {
      event.preventDefault();
      first?.focus();
    }
  }
</script>

<dialog
  class="dialog-card"
  role="alertdialog"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-desc"
  bind:this={dialogEl}
  oncancel={(event) => {
    event.preventDefault();
    onCancel();
  }}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <h2 id="dialog-title" class="section-title">Leave session?</h2>
  <p id="dialog-desc" class="dialog-text">
    {m.learn_exit_description()}
  </p>

  <div class="dialog-actions">
    <button type="button" class="btn-primary" onclick={onCancel}> Resume practice </button>
    <button type="button" class="btn-ghost" onclick={onConfirm}> Exit </button>
  </div>
</dialog>

<style>
  .dialog-card::backdrop {
    background: color-mix(in srgb, var(--bg-base) 70%, transparent);
  }

  .dialog-card {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-6);
    margin: auto;
    max-width: 26rem;
    width: calc(100% - 2 * var(--space-4));
    max-height: calc(100dvh - 2 * var(--space-4));
    overflow: auto;
  }

  .dialog-card[open] {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .section-title {
    margin: 0;
    font-size: var(--text-lg);
    color: var(--text-primary);
  }

  .dialog-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }
</style>

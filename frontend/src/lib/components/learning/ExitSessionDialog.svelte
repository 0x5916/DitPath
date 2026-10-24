<script lang="ts">
  import * as m from '#lib/paraglide/messages.js';
  import { dialogFocusables, dialogFocusTarget } from '../dialog-focus';

  interface Props {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    returnFocusTo?: HTMLElement | null;
    fallbackFocus?: HTMLElement | null;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }

  let {
    isOpen = false,
    onConfirm = () => {},
    onCancel = () => {},
    returnFocusTo = null,
    fallbackFocus = null,
    title,
    description,
    confirmLabel,
    cancelLabel
  }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  const dialogId = $props.id();

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
    if (event.key === 'Escape' && (event.repeat || event.isComposing || event.keyCode === 229)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab' || !dialogEl) return;
    const target = dialogFocusTarget(
      dialogFocusables(dialogEl),
      dialogEl.ownerDocument.activeElement as HTMLElement | null,
      event.shiftKey,
      dialogEl
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }
</script>

<dialog
  class="dialog-card"
  role="alertdialog"
  aria-labelledby={`${dialogId}-title`}
  aria-describedby={`${dialogId}-description`}
  bind:this={dialogEl}
  oncancel={(event) => {
    event.preventDefault();
    onCancel();
  }}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <h2 id={`${dialogId}-title`} class="section-title">{title ?? m.lesson_exit_title()}</h2>
  <p id={`${dialogId}-description`} class="dialog-text">
    {description ?? m.learn_exit_description()}
  </p>

  <div class="dialog-actions">
    <button type="button" class="btn-primary" onclick={onCancel}
      >{cancelLabel ?? m.lesson_resume()}</button
    >
    <button type="button" class="btn-ghost" onclick={onConfirm}
      >{confirmLabel ?? m.lesson_exit()}</button
    >
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
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .dialog-actions button {
    flex: 1 1 auto;
    min-height: var(--answer-target-min);
  }
</style>

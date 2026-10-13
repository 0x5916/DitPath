import type { GuidedSessionPhase } from '../../training/v2/guided-session';

/** Leave native controls, held keys and text composition to the browser. */
function acceptsKeyEvent(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return false;
  return true;
}

export function acceptsSessionShortcut(event: KeyboardEvent, allowButtonTarget = false): boolean {
  if (!acceptsKeyEvent(event)) return false;
  const target = event.target as Element | null;
  if (target?.closest?.('dialog[open], [aria-modal="true"]')) return false;
  const selector = 'input, textarea, select, a, [contenteditable]:not([contenteditable="false"])';
  return !target?.closest?.(allowButtonTarget ? selector : `${selector}, button`);
}

/** Enter advances introductions and feedback, including sound comparison. */
export function acceptsSessionContinue(event: KeyboardEvent, phase: GuidedSessionPhase): boolean {
  return (
    (phase === 'introducing' || phase === 'feedback') &&
    event.key === 'Enter' &&
    acceptsSessionShortcut(event)
  );
}

/** Escape also works from the answer field, but leaves native selects and modals alone. */
export function acceptsSessionEscape(event: KeyboardEvent): boolean {
  const target = event.target as Element | null;
  return (
    event.key === 'Escape' &&
    acceptsKeyEvent(event) &&
    !target?.closest?.('dialog[open], [aria-modal="true"], select')
  );
}

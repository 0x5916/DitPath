/** Return a focus destination only when native Tab would leave the dialog. */
export function dialogFocusTarget<T>(
  items: readonly T[],
  active: T | null,
  backwards: boolean,
  fallback: T
): T | null {
  if (items.length === 0) return fallback;
  const first = items[0];
  const last = items[items.length - 1];
  if (active === null || !items.includes(active)) return backwards ? last : first;
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return null;
}

/** Query at the time of Tab so disabled, hidden and removed controls are skipped. */
export function dialogFocusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, summary, [tabindex], [contenteditable]'
    )
  ).filter(
    (element) =>
      (element.tabIndex >= 0 || (element.isContentEditable && !element.hasAttribute('tabindex'))) &&
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden'
  );
}

export type PracticeKeyIntent = 'replay' | 'check' | 'stop';

/** Preserve native activation, editable spaces/newlines, IME and held keys. */
export function practiceKeyIntent(event: KeyboardEvent): PracticeKeyIntent | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return null;
  const target = event.target as Element | null;
  if (target?.closest?.('dialog[open], [aria-modal="true"], details[open]')) return null;
  if (event.key === 'Escape')
    return target?.closest?.('select, input, [contenteditable]:not([contenteditable="false"])')
      ? null
      : 'stop';
  const nativeControl = target?.closest?.(
    'button, input, select, a, summary, [contenteditable]:not([contenteditable="false"])'
  );
  if (nativeControl) return null;
  if (event.key === 'Enter') return 'check';
  if (event.key === ' ' && !target?.closest?.('textarea')) return 'replay';
  return null;
}

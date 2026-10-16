import { describe, expect, it } from 'vitest';
import { practiceKeyIntent } from './keyboard';

function event(key: string, values: Partial<KeyboardEvent> = {}, target = ''): KeyboardEvent {
  return {
    key,
    target: { closest: (selector: string) => (target && selector.includes(target) ? {} : null) },
    ...values
  } as KeyboardEvent;
}

describe('free practice keyboard policy', () => {
  it.each([
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true }
  ])('preserves handled, held, composing and modified keys: %j', (values) => {
    for (const key of [' ', 'Enter', 'Escape'])
      expect(practiceKeyIntent(event(key, values))).toBeNull();
  });

  it.each(['button', 'input', 'select', 'a', 'summary', '[contenteditable]'])(
    'leaves native Space and Enter activation to %s',
    (target) => {
      expect(practiceKeyIntent(event(' ', {}, target))).toBeNull();
      expect(practiceKeyIntent(event('Enter', {}, target))).toBeNull();
    }
  );

  it.each(['dialog[open]', '[aria-modal="true"]', 'details[open]'])(
    'does not run background shortcuts through %s',
    (target) => {
      for (const key of [' ', 'Enter', 'Escape'])
        expect(practiceKeyIntent(event(key, {}, target))).toBeNull();
    }
  );

  it('replays from the page and preserves spaces and Shift+Enter in the answer', () => {
    expect(practiceKeyIntent(event(' '))).toBe('replay');
    expect(practiceKeyIntent(event(' ', {}, 'textarea'))).toBeNull();
    expect(practiceKeyIntent(event('Enter', {}, 'textarea'))).toBe('check');
    expect(practiceKeyIntent(event('Enter', { shiftKey: true }, 'textarea'))).toBeNull();
    expect(practiceKeyIntent(event('Escape', {}, 'textarea'))).toBe('stop');
  });
});

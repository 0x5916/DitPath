import { describe, expect, it } from 'vitest';
import { dialogFocusTarget } from './dialog-focus';

const items = ['first', 'middle', 'last'];

describe('dialog Tab boundaries', () => {
  it('cycles backwards from the initially focused panel to the last control', () => {
    expect(dialogFocusTarget(items, 'panel', true, 'panel')).toBe('last');
    expect(dialogFocusTarget(items, 'panel', false, 'panel')).toBe('first');
  });

  it('contains focus that was moved outside or whose control was removed', () => {
    expect(dialogFocusTarget(items, 'outside', false, 'panel')).toBe('first');
    expect(dialogFocusTarget(items, null, true, 'panel')).toBe('last');
  });

  it('wraps at either end and lets the browser move between interior controls', () => {
    expect(dialogFocusTarget(items, 'first', true, 'panel')).toBe('last');
    expect(dialogFocusTarget(items, 'last', false, 'panel')).toBe('first');
    expect(dialogFocusTarget(items, 'middle', true, 'panel')).toBeNull();
    expect(dialogFocusTarget(items, 'middle', false, 'panel')).toBeNull();
  });

  it('retains the panel if every focusable control is hidden or disabled', () => {
    expect(dialogFocusTarget([], 'panel', true, 'panel')).toBe('panel');
    expect(dialogFocusTarget([], null, false, 'panel')).toBe('panel');
  });

  it('contains both directions when only one control remains', () => {
    expect(dialogFocusTarget(['only'], 'only', true, 'panel')).toBe('only');
    expect(dialogFocusTarget(['only'], 'only', false, 'panel')).toBe('only');
  });
});

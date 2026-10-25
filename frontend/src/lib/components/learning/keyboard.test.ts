import { describe, expect, it } from 'vitest';
import {
  acceptsAnswerReplay,
  acceptsSessionContinue,
  acceptsSessionEscape,
  acceptsSessionShortcut
} from './keyboard';

function keyEvent(overrides: Partial<KeyboardEvent> = {}, targetSelector?: string): KeyboardEvent {
  return {
    key: 'Escape',
    target: targetSelector
      ? { closest: (selector: string) => (selector.includes(targetSelector) ? {} : null) }
      : null,
    ...overrides
  } as KeyboardEvent;
}

describe('guided session keyboard policy', () => {
  it('replays from the answer field while preserving composition and modified keys', () => {
    const replay = keyEvent({ key: ' ', code: 'Space' }, 'input');
    expect(acceptsAnswerReplay(replay)).toBe(true);
    for (const overrides of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { defaultPrevented: true }
    ]) {
      expect(acceptsAnswerReplay({ ...replay, ...overrides })).toBe(false);
    }
    expect(acceptsAnswerReplay(keyEvent({ code: 'Space' }, 'dialog[open]'))).toBe(false);
    expect(acceptsAnswerReplay(keyEvent({ key: 'K', code: 'KeyK' }, 'input'))).toBe(false);
  });
  it.each([
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true }
  ])('leaves handled/composing/modified events alone: %j', (overrides) => {
    expect(acceptsSessionEscape(keyEvent(overrides))).toBe(false);
    expect(acceptsSessionShortcut(keyEvent(overrides))).toBe(false);
    expect(acceptsSessionContinue(keyEvent({ key: 'Enter', ...overrides }), 'introducing')).toBe(
      false
    );
  });

  it('allows Escape from the answer field but preserves native select cancellation', () => {
    expect(acceptsSessionEscape(keyEvent({}, 'input'))).toBe(true);
    expect(acceptsSessionEscape(keyEvent({}, 'select'))).toBe(false);
    expect(acceptsSessionEscape(keyEvent({ key: 'Enter' }))).toBe(false);
  });

  it('blocks every background shortcut from an open modal, including grid keys on buttons', () => {
    for (const key of ['Escape', 'Enter', ' ', 'K']) {
      const event = keyEvent({ key }, 'dialog[open]');
      expect(acceptsSessionEscape(event)).toBe(false);
      expect(acceptsSessionShortcut(event, true)).toBe(false);
      expect(acceptsSessionContinue(event, 'feedback')).toBe(false);
    }
  });

  it('preserves native button activation while retaining grid letter input', () => {
    expect(acceptsSessionShortcut(keyEvent({}, 'button'))).toBe(false);
    expect(acceptsSessionShortcut(keyEvent({ key: 'K' }, 'button'), true)).toBe(true);
    expect(acceptsSessionShortcut(keyEvent({}, 'input'), true)).toBe(false);
    expect(acceptsSessionContinue(keyEvent({ key: 'Enter' }, 'button'), 'introducing')).toBe(false);
    expect(acceptsSessionContinue(keyEvent({ key: 'Enter' }, 'input'), 'feedback')).toBe(false);
    expect(acceptsSessionShortcut(keyEvent({ key: ' ' }, 'summary'))).toBe(false);
    expect(acceptsSessionContinue(keyEvent({ key: 'Enter' }, 'summary'), 'feedback')).toBe(false);
  });

  it.each(['introducing', 'feedback'] as const)('continues from the page in %s', (phase) => {
    expect(acceptsSessionContinue(keyEvent({ key: 'Enter' }), phase)).toBe(true);
    expect(acceptsSessionContinue(keyEvent({ key: ' ' }), phase)).toBe(false);
  });

  it.each(['idle', 'ready', 'playing', 'answering', 'paused', 'complete', 'abandoned'] as const)(
    'does not skip an unanswered prompt or change the session in %s',
    (phase) => {
      expect(acceptsSessionContinue(keyEvent({ key: 'Enter' }), phase)).toBe(false);
    }
  );
});

import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RecognitionPrompt from './RecognitionPrompt.svelte';

const noop = () => {};
const props = {
  typed: false,
  options: ['K', 'M'],
  expected: 'K',
  entered: 'K',
  isCorrect: true,
  classification: 'automatic' as const,
  playingCharacter: null,
  audioError: null,
  onPlay: noop,
  onReplay: noop,
  onSelect: noop,
  onSubmit: noop,
  onHear: noop,
  onContinue: noop
};

describe('choice assessment context', () => {
  it.each(['ready', 'feedback'] as const)(
    'only labels unscored choices as warm-up in %s',
    (phase) => {
      const warmup = render(RecognitionPrompt, { props: { ...props, phase, scored: false } }).body;
      const scored = render(RecognitionPrompt, { props: { ...props, phase, scored: true } }).body;
      expect(warmup).toMatch(/warm-up/i);
      expect(scored).not.toMatch(/warm-up/i);
      if (phase === 'feedback') expect(scored).toContain('Recognized quickly');
    }
  );
});

it('keeps a mixed check sound-first until playback finishes', () => {
  const check = { ...props, typed: true, scored: true, assessment: true };
  const playing = render(RecognitionPrompt, { props: { ...check, phase: 'playing' } }).body;
  expect(playing).toContain('Playing sound…');
  expect(playing).toContain('Type your answer when the sound finishes.');
  expect(playing).not.toMatch(/Listening…|Press Space|aria-keyshortcuts="Space"|<input/);

  const answering = render(RecognitionPrompt, { props: { ...check, phase: 'answering' } }).body;
  expect(answering).toContain('Replay sound');
  expect(answering).toContain('Type one character to submit.');
  expect(answering).not.toContain('Playing sound…');
});

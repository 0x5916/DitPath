import { describe, expect, it } from 'vitest';
import { scorePromptAttempt } from './attempt';
import type { Prompt } from './types';

function createMockPrompt(
  expectedText: string,
  isScored = true,
  kind: Prompt['spec']['kind'] = 'recall'
): Prompt {
  return {
    id: 'prm_test_1',
    ordinal: 1,
    isScored,
    spec: {
      kind,
      expectedText,
      characters: [expectedText],
      charWpm: 20,
      effWpm: 12,
      freqHz: 600
    }
  };
}

describe('Prompt Attempt Scoring', () => {
  it('classifies correct fast answers as automatic', () => {
    const prompt = createMockPrompt('T');
    const event = scorePromptAttempt({
      prompt,
      sessionId: 'sess_1',
      enteredText: 't', // case insensitive
      answerReadyAtMs: 1000,
      submittedAtMs: 2200, // latency: 1200ms <= 1500ms
      replayCount: 0,
      inputMode: 'keyboard'
    });

    expect(event.isCorrect).toBe(true);
    expect(event.classification).toBe('automatic');
    expect(event.latencyMs).toBe(1200);
    expect(event.enteredText).toBe('T');
  });

  it('preserves correctness for slow correct answers (classifies as developing)', () => {
    const prompt = createMockPrompt('T');
    const event = scorePromptAttempt({
      prompt,
      sessionId: 'sess_1',
      enteredText: 'T',
      answerReadyAtMs: 1000,
      submittedAtMs: 3800, // latency: 2800ms > 1500ms
      replayCount: 0,
      inputMode: 'keyboard'
    });

    expect(event.isCorrect).toBe(true);
    expect(event.classification).toBe('developing');
    expect(event.latencyMs).toBe(2800);
  });

  it('records replays without marking correct answers incorrect', () => {
    const prompt = createMockPrompt('M');
    const event = scorePromptAttempt({
      prompt,
      sessionId: 'sess_1',
      enteredText: 'M',
      answerReadyAtMs: 1000,
      submittedAtMs: 2200,
      replayCount: 3,
      inputMode: 'keyboard'
    });

    expect(event.isCorrect).toBe(true);
    expect(event.replayCount).toBe(3);
  });

  it('classifies wrong answers as incorrect', () => {
    const prompt = createMockPrompt('M');
    const event = scorePromptAttempt({
      prompt,
      sessionId: 'sess_1',
      enteredText: 'T',
      answerReadyAtMs: 1000,
      submittedAtMs: 2000,
      replayCount: 1,
      inputMode: 'grid'
    });

    expect(event.isCorrect).toBe(false);
    expect(event.classification).toBe('incorrect');
    expect(event.enteredText).toBe('T');
  });

  it('classifies empty input as missing', () => {
    const prompt = createMockPrompt('K');
    const event = scorePromptAttempt({
      prompt,
      sessionId: 'sess_1',
      enteredText: '   ',
      answerReadyAtMs: 1000,
      submittedAtMs: 3000,
      replayCount: 0,
      inputMode: 'keyboard'
    });

    expect(event.isCorrect).toBe(false);
    expect(event.classification).toBe('missing');
  });

  it('scores punctuation accurately', () => {
    const promptQuestion = createMockPrompt('?');
    const event = scorePromptAttempt({
      prompt: promptQuestion,
      sessionId: 'sess_1',
      enteredText: ' ? ',
      answerReadyAtMs: 1000,
      submittedAtMs: 2100,
      replayCount: 0,
      inputMode: 'keyboard'
    });

    expect(event.isCorrect).toBe(true);
    expect(event.enteredText).toBe('?');
  });

  it('classifies unscored prompts as unmeasured regardless of correctness', () => {
    const prompt = createMockPrompt('R', false, 'introduction');
    const event = scorePromptAttempt({
      prompt,
      sessionId: 'sess_1',
      enteredText: 'R',
      answerReadyAtMs: 1000,
      submittedAtMs: 2000,
      replayCount: 0,
      inputMode: 'grid'
    });

    expect(event.isCorrect).toBe(true);
    expect(event.classification).toBe('unmeasured');
  });

  it('rejects impossible timestamps where submission precedes answerReady', () => {
    const prompt = createMockPrompt('A');
    expect(() =>
      scorePromptAttempt({
        prompt,
        sessionId: 'sess_1',
        enteredText: 'A',
        answerReadyAtMs: 2000,
        submittedAtMs: 1000,
        replayCount: 0,
        inputMode: 'keyboard'
      })
    ).toThrow('Invalid timing');
  });
});

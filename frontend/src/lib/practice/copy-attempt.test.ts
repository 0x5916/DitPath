import { describe, expect, it } from 'vitest';
import { canCheck } from '../training/session';
import { calculateDuration } from '../training/timing';
import {
  createCopyAttempt,
  emptyCopyAttempt,
  copyPlaybackEvent,
  createPracticeSessionRecord,
  reviewCopyAttempt,
  copyInputLimit,
  boundCopyInput
} from './copy-attempt';
import { normalizePlaybackSettings } from './playback';

const settings = normalizePlaybackSettings({});
const create = () => createCopyAttempt(1, settings, undefined, () => 0);

describe('free copy attempt', () => {
  it('records a reviewed passage with its original playback time, score and settings', () => {
    const ready = createCopyAttempt(3, { ...settings, freq: 700 }, undefined, () => 0);
    expect(createPracticeSessionRecord(ready, 'practice-1')).toBeNull();
    expect(copyPlaybackEvent(ready, 'stop').startedAt).toBeUndefined();
    const started = copyPlaybackEvent(ready, 'start', '2026-10-16T00:00:00.000Z');
    const reviewed = reviewCopyAttempt(started, 'wrong', '2026-10-16T00:01:30.000Z');
    const record = createPracticeSessionRecord(reviewed, 'practice-1');
    expect(record).toEqual({
      schemaVersion: 1,
      id: 'practice-1',
      mode: 'practice',
      accuracy: 0,
      step: 3,
      charWpm: settings.charWpm,
      effWpm: settings.effWpm,
      freqHz: 700,
      startedAt: '2026-10-16T00:00:00.000Z',
      completedAt: '2026-10-16T00:01:30.000Z',
      status: 'completed',
      promptCount: 1,
      completedPromptCount: 1
    });
    const replaying = copyPlaybackEvent(reviewed, 'start', '2026-10-16T00:02:00.000Z');
    expect(createPracticeSessionRecord(replaying, 'practice-1')).toEqual(record);
    expect(createCopyAttempt(3, settings, replaying).startedAt).toBeUndefined();
    expect(
      createPracticeSessionRecord({ ...reviewed, startedAt: undefined }, 'missing')
    ).toBeNull();
  });

  it('keeps prerender state deterministic and unstarted', () => {
    expect(emptyCopyAttempt()).toEqual(emptyCopyAttempt());
    expect(emptyCopyAttempt().exercise.text).toBe('');
    expect(emptyCopyAttempt().session.status).toBe('ready');
  });

  it('creates one stable exercise with a normalized settings snapshot and exact duration', () => {
    const attempt = createCopyAttempt(
      Number.NaN,
      { charWpm: 8, effWpm: 50, freq: Number.NaN, volume: 1, startDelay: 0 },
      undefined,
      () => 0
    );
    expect(attempt.exercise.lesson).toBe(1);
    expect(attempt.settings).toMatchObject({ charWpm: 8, effWpm: 8, freq: 600 });
    expect(attempt.duration).toBe(calculateDuration(attempt.exercise.text, 8, 8));
    const started = copyPlaybackEvent(attempt, 'start');
    expect(started.exercise).toBe(attempt.exercise);
    expect(canCheck(started.session)).toBe(true);
  });

  it('only reviews after a successful start and rejects empty input', () => {
    const attempt = create();
    expect(reviewCopyAttempt(attempt, 'K')).toBe(attempt);
    const started = copyPlaybackEvent(attempt, 'start');
    expect(reviewCopyAttempt(started, ' ')).toBe(started);
    const stopped = copyPlaybackEvent(started, 'stop');
    const reviewed = reviewCopyAttempt(stopped, stopped.exercise.text, '2026-10-16T00:00:00Z');
    expect(reviewed.review?.result).toMatchObject({
      lesson: 1,
      charWpm: settings.charWpm,
      effWpm: settings.effWpm,
      accuracy: 1,
      completedAt: '2026-10-16T00:00:00Z'
    });
    expect(reviewed.session.status).toBe('reviewed');
    expect(reviewCopyAttempt(reviewed, 'wrong')).toBe(reviewed);
  });

  it('replays a reviewed exercise for listening without allowing another score', () => {
    const started = copyPlaybackEvent(create(), 'start');
    const reviewed = reviewCopyAttempt(started, started.exercise.text);
    const replaying = copyPlaybackEvent(reviewed, 'start');
    expect(canCheck(replaying.session)).toBe(false);
    expect(copyPlaybackEvent(replaying, 'stop').session.status).toBe('reviewed');
    expect(replaying.review).toBe(reviewed.review);
  });

  it('replacing an active or reviewed attempt clears its review and requires new playback', () => {
    const started = copyPlaybackEvent(create(), 'start');
    for (const previous of [started, reviewCopyAttempt(started, started.exercise.text)]) {
      const next = createCopyAttempt(2, { ...settings, charWpm: 30 }, previous, () => 0);
      expect(next.exercise.lesson).toBe(2);
      expect(next.settings.charWpm).toBe(30);
      expect(next.session.attempt).toBe(previous.session.attempt + 1);
      expect(next.session.status).toBe('ready');
      expect(next.review).toBeNull();
      expect(canCheck(next.session)).toBe(false);
    }
  });

  it('bounds both pasted text and programmatic review input to the current passage', () => {
    const started = copyPlaybackEvent(create(), 'start');
    const limit = copyInputLimit(started.exercise.text);
    const input = 'X '.repeat(100_000);
    expect(boundCopyInput(started.exercise.text, input)).toHaveLength(limit);
    const reviewed = reviewCopyAttempt(started, input);
    expect(reviewed.review?.result.accuracy).toBe(0);
    expect(
      reviewed
        .review!.diffTokens.map((token) => token.inp)
        .filter(Boolean)
        .join(' ')
    ).toHaveLength(limit - 1);
    expect(copyInputLimit('')).toBe(1);
  });

  it('preserves case, whitespace, insertion and deletion scoring within the copy limit', () => {
    const started = copyPlaybackEvent(create(), 'start');
    const copy = ` ${started.exercise.text.toLowerCase().replaceAll(' ', '\n')} `;
    expect(reviewCopyAttempt(started, copy).review?.result.accuracy).toBe(1);
    expect(boundCopyInput(started.exercise.text, copy)).toBe(copy);
    const inserted = `X${started.exercise.text}`;
    const deleted = started.exercise.text.slice(1);
    expect(reviewCopyAttempt(started, inserted).review?.result.accuracy).toBeGreaterThan(0);
    expect(reviewCopyAttempt(started, deleted).review?.result.accuracy).toBeGreaterThan(0);
  });
});

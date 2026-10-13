import { describe, expect, it } from 'vitest';
import type { AttemptResult } from './result';
import { createAttemptResult } from './result';
import { canCheck, createSession, isAttemptRecorded, transition } from './session';
import type { SessionEvent, SessionState } from './session';

const COMPLETED_AT = '2026-01-02T03:04:05.000Z';

function result(accuracy = 0.8): AttemptResult {
  return createAttemptResult({
    lesson: 2,
    charWpm: 20,
    effWpm: 10,
    accuracy,
    completedAt: COMPLETED_AT
  });
}

function must(
  state: SessionState,
  event: SessionEvent
): { state: SessionState; effects: Array<{ kind: string; result: AttemptResult }> } {
  const outcome = transition(state, event);
  if (!outcome.ok) throw new Error(`expected transition to succeed: ${outcome.reason}`);
  return outcome;
}

function mustReject(state: SessionState, event: SessionEvent): SessionState {
  const outcome = transition(state, event);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('expected transition to fail');
  expect(outcome.state).toEqual(state);
  return state;
}

describe('session lifecycle', () => {
  it('starts ready with an open first attempt', () => {
    const session = createSession();
    expect(session).toEqual({ status: 'ready', attempt: 1, recordedAttempt: null });
    expect(canCheck(session)).toBe(false);
    expect(isAttemptRecorded(session)).toBe(false);
  });

  it('walks ready → playing → paused → playing → awaiting-check → reviewed', () => {
    let session = createSession();
    session = must(session, { type: 'start' }).state;
    expect(session.status).toBe('playing');
    expect(canCheck(session)).toBe(true);

    session = must(session, { type: 'pause' }).state;
    expect(session.status).toBe('paused');

    session = must(session, { type: 'resume' }).state;
    expect(session.status).toBe('playing');

    session = must(session, { type: 'stop' }).state;
    expect(session.status).toBe('awaiting-check');

    const outcome = must(session, { type: 'check', result: result(0.75) });
    expect(outcome.state.status).toBe('reviewed');
    expect(outcome.effects).toEqual([{ kind: 'record-result', result: result(0.75) }]);
    expect(isAttemptRecorded(outcome.state)).toBe(true);
  });

  it('supports checking while playback is still active', () => {
    let session = must(createSession(), { type: 'start' }).state;
    session = must(session, { type: 'pause' }).state;

    const outcome = must(session, { type: 'check', result: result(0.5) });
    expect(outcome.state.status).toBe('reviewed');
    expect(outcome.effects).toHaveLength(1);
    // Audio already stopped by the check: a late stop event is invalid.
    mustReject(outcome.state, { type: 'stop' });
  });

  it('records a completed attempt at most once', () => {
    let session = must(createSession(), { type: 'start' }).state;
    session = must(session, { type: 'stop' }).state;
    const first = must(session, { type: 'check', result: result(0.4) });

    const second = transition(first.state, { type: 'check', result: result(0.9) });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected repeated check to fail');
    expect(second.reason).toBe('attempt already recorded');
    expect(second.state).toEqual(first.state);
  });

  it('rejects checking before playback and after review', () => {
    mustReject(createSession(), { type: 'check', result: result() });
    const reviewed = must(must(createSession(), { type: 'start' }).state, {
      type: 'check',
      result: result()
    }).state;
    mustReject(reviewed, { type: 'check', result: result() });
  });

  it('rejects pause, resume and stop when they do not apply', () => {
    const session = createSession();
    mustReject(session, { type: 'pause' });
    mustReject(session, { type: 'resume' });
    mustReject(session, { type: 'stop' });

    const playing = must(session, { type: 'start' }).state;
    mustReject(playing, { type: 'resume' });
    mustReject(playing, { type: 'start' });

    const paused = must(playing, { type: 'pause' }).state;
    mustReject(paused, { type: 'pause' });

    const awaiting = must(paused, { type: 'stop' }).state;
    mustReject(awaiting, { type: 'stop' });
    mustReject(awaiting, { type: 'resume' });
  });
});

describe('replay after review', () => {
  it('plays again but never re-opens the recorded attempt', () => {
    const reviewed = must(
      must(must(createSession(), { type: 'start' }).state, { type: 'stop' }).state,
      { type: 'check', result: result(0.65) }
    ).state;

    const replaying = must(reviewed, { type: 'start' }).state;
    expect(replaying.status).toBe('playing');
    expect(canCheck(replaying)).toBe(false);

    const afterReplay = must(replaying, { type: 'stop' }).state;
    expect(afterReplay.status).toBe('reviewed');
    mustReject(afterReplay, { type: 'check', result: result(0.99) });
  });
});

describe('exercise replacement', () => {
  it('new-exercise and lesson-change reset to ready with a fresh attempt number', () => {
    const checked = must(
      must(must(createSession(), { type: 'start' }).state, { type: 'stop' }).state,
      { type: 'check', result: result(0.8) }
    ).state;

    const regenerated = must(checked, { type: 'new-exercise' }).state;
    expect(regenerated).toEqual({ status: 'ready', attempt: 2, recordedAttempt: 1 });
    expect(canCheck(regenerated)).toBe(false);

    // The second attempt can be played and recorded exactly once.
    const second = must(must(must(regenerated, { type: 'start' }).state, { type: 'stop' }).state, {
      type: 'check',
      result: result(0.95)
    });
    expect(second.state.recordedAttempt).toBe(2);
    expect(second.effects).toHaveLength(1);

    const lessonChanged = must(second.state, { type: 'lesson-change' }).state;
    expect(lessonChanged).toEqual({ status: 'ready', attempt: 3, recordedAttempt: 2 });
  });

  it('replacing an in-flight exercise stops the old attempt cleanly', () => {
    const playing = must(createSession(), { type: 'start' }).state;
    const session = must(playing, { type: 'new-exercise' }).state;
    expect(session.status).toBe('ready');
    expect(isAttemptRecorded(session)).toBe(false);
  });
});

describe('mode changes', () => {
  it('ends active playback but preserves the typed attempt', () => {
    const playing = must(createSession(), { type: 'start' }).state;
    const session = must(playing, { type: 'mode-change' }).state;
    expect(session.status).toBe('awaiting-check');
    expect(canCheck(session)).toBe(true);
  });

  it('is a valid no-op while idle, awaiting or reviewed', () => {
    const ready = createSession();
    expect(must(ready, { type: 'mode-change' }).state).toBe(ready);

    const awaiting = must(must(ready, { type: 'start' }).state, { type: 'stop' }).state;
    expect(must(awaiting, { type: 'mode-change' }).state).toBe(awaiting);

    const reviewed = must(awaiting, { type: 'check', result: result() }).state;
    expect(must(reviewed, { type: 'mode-change' }).state).toBe(reviewed);
  });
});

describe('disposal', () => {
  it('is idempotent and rejects every later event', () => {
    const disposed = must(createSession(), { type: 'dispose' }).state;
    expect(disposed.status).toBe('disposed');

    expect(must(disposed, { type: 'dispose' }).state).toBe(disposed);
    mustReject(disposed, { type: 'start' });
    mustReject(disposed, { type: 'check', result: result() });
    mustReject(disposed, { type: 'new-exercise' });
    mustReject(disposed, { type: 'mode-change' });
  });
});

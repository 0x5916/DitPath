/**
 * The assessed passage attempt lifecycle.
 *
 * One typed state is authoritative for the attempt; the page derives its UI
 * flags (answer box unlocked, transport running, check available) from it
 * instead of keeping parallel booleans. Presentation state such as the result
 * overlay's visibility deliberately stays outside this machine.
 *
 * Transitions are total and reversible into a verdict: invalid events are
 * rejected without changing state, and a completed attempt can be recorded at
 * most once.
 */

import type { AttemptResult } from './result';

export type SessionStatus =
  | 'ready'
  | 'playing'
  | 'paused'
  /** Playback is over (or was stopped); the copy can be typed and checked. */
  | 'awaiting-check'
  /** The attempt has been checked and recorded; further checks are rejected. */
  | 'reviewed'
  | 'disposed';

export interface SessionState {
  status: SessionStatus;
  /** Increments whenever a new exercise replaces the current one. */
  attempt: number;
  /** Attempt number whose result was already recorded, if any. */
  recordedAttempt: number | null;
}

export type SessionEvent =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  /** Playback ended — naturally, via the transport or via Escape. */
  | { type: 'stop' }
  /** The learner switched between drill and passage; an active attempt pauses. */
  | { type: 'mode-change' }
  /** The assessed exercise is replaced by regenerating the current lesson. */
  | { type: 'new-exercise' }
  /** The assessed exercise is replaced because another lesson was chosen. */
  | { type: 'lesson-change' }
  | { type: 'check'; result: AttemptResult }
  | { type: 'dispose' };

export interface SessionEffect {
  kind: 'record-result';
  result: AttemptResult;
}

export type SessionTransition =
  | { ok: true; state: SessionState; effects: SessionEffect[] }
  | { ok: false; reason: string; state: SessionState };

export function createSession(): SessionState {
  return { status: 'ready', attempt: 1, recordedAttempt: null };
}

export function isAttemptRecorded(state: SessionState): boolean {
  return state.recordedAttempt === state.attempt;
}

export function canStart(state: SessionState): boolean {
  return state.status !== 'playing' && state.status !== 'paused' && state.status !== 'disposed';
}

export function canCheck(state: SessionState): boolean {
  if (
    state.status !== 'playing' &&
    state.status !== 'paused' &&
    state.status !== 'awaiting-check'
  ) {
    return false;
  }
  return !isAttemptRecorded(state);
}

export function canPause(state: SessionState): boolean {
  return state.status === 'playing';
}

export function canResume(state: SessionState): boolean {
  return state.status === 'paused';
}

export function transition(state: SessionState, event: SessionEvent): SessionTransition {
  const accept = (next: SessionState, effects: SessionEffect[] = []): SessionTransition => ({
    ok: true,
    state: next,
    effects
  });
  const reject = (reason: string): SessionTransition => ({ ok: false, reason, state });

  if (state.status === 'disposed') {
    // Disposal is idempotent; everything else is invalid once disposed.
    return event.type === 'dispose' ? accept(state) : reject('session is disposed');
  }

  switch (event.type) {
    case 'dispose':
      return accept({ ...state, status: 'disposed' });

    case 'start':
      if (!canStart(state)) return reject(`cannot start from ${state.status}`);
      return accept({ ...state, status: 'playing' });

    case 'pause':
      if (!canPause(state)) return reject(`cannot pause from ${state.status}`);
      return accept({ ...state, status: 'paused' });

    case 'resume':
      if (!canResume(state)) return reject(`cannot resume from ${state.status}`);
      return accept({ ...state, status: 'playing' });

    case 'stop': {
      if (state.status !== 'playing' && state.status !== 'paused') {
        return reject(`no active playback in ${state.status}`);
      }
      // Replaying after a review is listening-only: it never re-opens the
      // recorded attempt for another check.
      return accept({
        ...state,
        status: isAttemptRecorded(state) ? 'reviewed' : 'awaiting-check'
      });
    }

    case 'mode-change': {
      if (state.status === 'playing' || state.status === 'paused') {
        return accept({
          ...state,
          status: isAttemptRecorded(state) ? 'reviewed' : 'awaiting-check'
        });
      }
      // Idle, awaiting or reviewed: switching practice never discards input.
      return accept(state);
    }

    case 'new-exercise':
    case 'lesson-change':
      return accept({
        status: 'ready',
        attempt: state.attempt + 1,
        recordedAttempt: state.recordedAttempt
      });

    case 'check': {
      if (!canCheck(state)) {
        return reject(
          isAttemptRecorded(state)
            ? 'attempt already recorded'
            : `cannot check from ${state.status}`
        );
      }
      return accept({ ...state, status: 'reviewed', recordedAttempt: state.attempt }, [
        { kind: 'record-result', result: event.result }
      ]);
    }
  }
}

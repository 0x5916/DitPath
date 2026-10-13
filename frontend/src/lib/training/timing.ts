/**
 * Morse timing and the audio plan.
 *
 * The plan is the single source of truth for both playback scheduling and the
 * duration/progress display: it is produced here, consumed by the audio engine
 * unchanged, and its `totalDuration` drives the transport clock.
 */

import { MORSE } from './sequence';

export interface FarnsworthTimings {
  charDot: number;
  tFarn: number;
  dash: number;
  symbolSpace: number;
  letterSpace: number;
  wordSpace: number;
}

export function getFarnsworthWpmSet(charWpm: number, effWpm: number): FarnsworthTimings {
  const charDot = 1.2 / charWpm;
  const tFarn = (60 / effWpm - charDot * 31) / 19;

  const dash = charDot * 3;
  const symbolSpace = charDot;

  const letterSpace = tFarn * 3;
  const wordSpace = tFarn * 7;

  return { charDot, tFarn, dash, symbolSpace, letterSpace, wordSpace };
}

export function calculateDuration(text: string, charWpm: number, effWpm: number): number {
  const timings = getFarnsworthWpmSet(charWpm, effWpm);
  return walkTimeline(text.toUpperCase(), timings);
}

/** Accumulate timing in playback order, optionally recording the tone schedule. */
function walkTimeline(upper: string, timings: FarnsworthTimings, events?: ToneEvent[]): number {
  const { charDot, dash, symbolSpace, letterSpace, wordSpace } = timings;
  let t = 0;

  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    const morse = MORSE[ch];
    if (!morse) {
      t += wordSpace;
      continue;
    }
    for (let j = 0; j < morse.length; j++) {
      const duration = morse[j] === '.' ? charDot : dash;
      events?.push({ start: t, duration });
      t += duration;
      if (j < morse.length - 1) t += symbolSpace;
    }
    if (i < upper.length - 1) t += letterSpace;
  }

  return t;
}

/** One tone the engine should schedule, relative to the transmission start. */
export interface ToneEvent {
  start: number;
  duration: number;
}

export interface AudioPlan {
  /** Uppercase source text the plan was built from. */
  text: string;
  events: ToneEvent[];
  /** End of the last tone, excluding `startDelay`. */
  totalDuration: number;
  /** Silence scheduled before the first tone. */
  startDelay: number;
  /** Gain ramp length at each tone edge. */
  fade: number;
  frequency: number;
  volume: number;
}

export interface AudioPlanOptions {
  charWpm: number;
  effWpm: number;
  frequency?: number;
  volume?: number;
  startDelay?: number;
}

/**
 * Turn a passage into the exact tone schedule the engine plays, using the same
 * Farnsworth timings as `calculateDuration` so the clock and the audio agree.
 */
export function buildAudioPlan(text: string, options: AudioPlanOptions): AudioPlan {
  const { charWpm, effWpm, frequency = 600, volume = 1, startDelay = 0 } = options;
  const timings = getFarnsworthWpmSet(charWpm, effWpm);

  const events: ToneEvent[] = [];
  const upper = text.toUpperCase();
  const totalDuration = walkTimeline(upper, timings, events);

  return {
    text: upper,
    events,
    totalDuration,
    startDelay,
    fade: Math.min(timings.charDot * 0.1, 0.005),
    frequency,
    volume
  };
}

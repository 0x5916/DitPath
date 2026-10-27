/**
 * Browser audio engine for Morse playback.
 *
 * The engine owns the AudioContext lifecycle and schedules the tone events of
 * an `AudioPlan` on the Web Audio timeline (never setTimeout/setInterval).
 * Browser resources are created lazily on the first `play()` — i.e. after a
 * user gesture — and torn down by `stop()`/`dispose()`, both of which are safe
 * to call repeatedly and while idle.
 *
 * A playback generation counter invalidates callbacks from an older playback,
 * so a stale oscillator ending can never stop or update a newer one.
 */

import type { AudioPlan } from '../training/timing';

export type AudioEngineEvent = 'ended';

export interface AudioEngine {
  /** Schedule a plan on the audio timeline, replacing any current playback. */
  play(plan: AudioPlan): void;
  /** Suspend the timeline; safe while idle. */
  pause(): Promise<void>;
  /** Resume a suspended timeline; safe while idle. */
  resume(): Promise<void>;
  /** Stop and release playback. `notify: false` suppresses the ended event. */
  stop(options?: { notify?: boolean }): Promise<void>;
  /** Stop silently and release every resource; safe to call repeatedly. */
  dispose(): Promise<void>;
  /** Listen for playback end; returns an unsubscribe function. */
  subscribe(listener: (event: AudioEngineEvent) => void): () => void;
  /** True while a playback exists (playing or paused). */
  isActive(): boolean;
  isPaused(): boolean;
  /** Seconds since the plan's clock started (after the lead-in), including its start delay. */
  elapsed(): number;
}

export type AudioContextFactory = () => AudioContext;

/**
 * Silent time kept on the timeline after the last tone. The oscillator's
 * `ended` event fires when it is rendered, but the sound reaches the speaker
 * one output latency later and `close()` discards whatever is still in flight.
 * Without this tail the end of the final tone is clipped, which is most
 * audible on a short last dot such as the end of R or S.
 */
export const MIN_OUTPUT_TAIL = 0.15;

/**
 * Silence before the first tone. A new AudioContext needs a moment before its
 * first samples reach the speaker, so a tone scheduled right at the start loses
 * its beginning: the first dot of S is barely heard and the first dash of K
 * sounds like a dot. Looping hides it because the context is warm by then.
 * `elapsed()` starts counting after this lead-in, so the clock is unchanged.
 */
export const START_LEAD_IN = 0.2;

function usableSeconds(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** How long to keep the context alive after the last tone has been rendered. */
function outputTail(audio: AudioContext): number {
  const reported = usableSeconds(audio.baseLatency) + usableSeconds(audio.outputLatency);
  return Math.max(MIN_OUTPUT_TAIL, reported + 0.05);
}

export interface WebAudioEngineOptions {
  /** Test seam; defaults to `new AudioContext()` on first play. */
  createContext?: AudioContextFactory;
}

export function createWebAudioEngine(options: WebAudioEngineOptions = {}): AudioEngine {
  const createContext: AudioContextFactory = options.createContext ?? (() => new AudioContext());
  const listeners = new Set<(event: AudioEngineEvent) => void>();

  let ctx: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  let outputGain: GainNode | null = null;
  let ctxStartTime = 0;
  let generation = 0;
  let active = false;
  let paused = false;
  let disposed = false;
  let endedNotified = true;

  function notifyEnded(): void {
    for (const listener of [...listeners]) listener('ended');
  }

  async function stopInternal(notify: boolean): Promise<void> {
    const hadPlayback = active || ctx !== null;
    if (!hadPlayback) return;

    active = false;
    paused = false;
    const stoppedGeneration = ++generation;
    const audio = ctx;
    const oldOscillator = oscillator;
    const oldGain = outputGain;
    ctx = null;
    oscillator = null;
    outputGain = null;
    // Close the notification window synchronously so a silent stop can never
    // clobber the ended flag of a playback that starts while close() settles.
    const shouldNotify = notify && !endedNotified;
    endedNotified = true;
    // Context shutdown is asynchronous. Cut the output before a replacement
    // can start, even if close() is delayed or fails.
    oldGain?.disconnect();
    if (oldOscillator) {
      oldOscillator.onended = null;
      oldOscillator.disconnect();
      try {
        oldOscillator.stop(audio?.currentTime);
      } catch {
        // An oscillator that has already ended needs no further stop.
      }
    }
    try {
      await audio?.close();
    } catch {
      // Closing an already-closed context is harmless.
    }
    if (shouldNotify && !disposed && generation === stoppedGeneration) notifyEnded();
  }

  function play(plan: AudioPlan): void {
    if (disposed) return;
    if (active || ctx !== null) void stopInternal(false);

    const gen = ++generation;
    endedNotified = false;
    active = true;
    paused = false;

    const audio = createContext();
    ctx = audio;

    const osc = audio.createOscillator();
    oscillator = osc;
    const gain = audio.createGain();
    outputGain = gain;
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.frequency.value = plan.frequency;

    // Match the original player: read the clock after graph setup and silence
    // the oscillator immediately. A future zero leaves GainNode's default
    // gain of 1 audible throughout the start delay.
    const now = audio.currentTime;
    ctxStartTime = now + START_LEAD_IN;
    const t0 = ctxStartTime + plan.startDelay;
    gain.gain.setValueAtTime(0, now);
    for (const event of plan.events) {
      const start = t0 + event.start;
      const end = start + event.duration;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(plan.volume, start + plan.fade);
      gain.gain.setValueAtTime(plan.volume, end - plan.fade);
      gain.gain.linearRampToValueAtTime(0, end);
    }

    osc.onended = () => {
      // A callback from a replaced playback must never touch this one.
      if (disposed || gen !== generation) return;
      void stopInternal(true);
    };

    osc.start();
    // The gain is already 0 after the last tone, so the extra time is silent.
    osc.stop(t0 + plan.totalDuration + outputTail(audio));
  }

  async function pause(): Promise<void> {
    if (disposed || !active || paused || !ctx) return;
    const audio = ctx;
    const gen = generation;
    await audio.suspend();
    if (!disposed && gen === generation && ctx === audio) paused = true;
  }

  async function resume(): Promise<void> {
    if (disposed || !active || !paused || !ctx) return;
    const audio = ctx;
    const gen = generation;
    await audio.resume();
    if (!disposed && gen === generation && ctx === audio) paused = false;
  }

  async function stop(options: { notify?: boolean } = {}): Promise<void> {
    if (disposed) return;
    await stopInternal(options.notify ?? true);
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    await stopInternal(false);
    listeners.clear();
  }

  return {
    play,
    pause,
    resume,
    stop,
    dispose,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isActive: () => active,
    isPaused: () => paused,
    elapsed: () => (active && ctx ? Math.max(ctx.currentTime - ctxStartTime, 0) : 0)
  };
}

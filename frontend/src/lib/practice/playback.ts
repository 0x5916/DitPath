import type { AudioEngine } from '../audio/engine';
import { buildAudioPlan, type AudioPlan } from '../training/timing';
import { MORSE } from '../training/sequence';

export interface PlaybackSettings {
  charWpm: number;
  effWpm: number;
  freq: number;
  volume: number;
  startDelay: number;
}

/** Keep editable browser values finite and Farnsworth spacing nonnegative. */
export function normalizePlaybackSettings(settings: Partial<PlaybackSettings>): PlaybackSettings {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Number.isFinite(value) ? value! : fallback));
  const charWpm = bounded(settings.charWpm, 20, 5, 50);
  return {
    charWpm,
    effWpm: bounded(settings.effWpm, 12, 5, charWpm),
    freq: bounded(settings.freq, 600, 300, 2000),
    volume: bounded(settings.volume, 1, 0, 1),
    startDelay: bounded(settings.startDelay, 0, 0, 10)
  };
}

export interface PlaybackState {
  started: boolean;
  paused: boolean;
  busy: boolean;
  progress: number;
  timer: number;
  text: string;
  plan: AudioPlan | null;
  failed: boolean;
}

export function idlePlayback(text = ''): PlaybackState {
  return {
    started: false,
    paused: false,
    busy: false,
    progress: 0,
    timer: 0,
    text,
    plan: null,
    failed: false
  };
}

interface PlaybackPorts {
  engine: AudioEngine;
  getSettings: () => PlaybackSettings;
  onChange: (state: PlaybackState) => void;
  onStart: (settings: PlaybackSettings) => void;
  onEnded: () => void;
}

/** Transport orchestration; browser clocks and rendering stay with the caller. */
export function createPlaybackController(ports: PlaybackPorts) {
  const { engine } = ports;
  let state = idlePlayback();
  let generation = 0;
  let disposed = false;

  function publish(next: PlaybackState) {
    state = next;
    if (!disposed) ports.onChange(state);
  }

  function reset(failed = false) {
    publish({ ...idlePlayback(state.text), failed });
  }

  function fail(expectedGeneration: number) {
    if (disposed || expectedGeneration !== generation) return;
    const wasStarted = state.started;
    generation += 1;
    void engine.stop({ notify: false }).catch(() => {});
    reset(true);
    if (wasStarted) ports.onEnded();
  }

  function stop(notify = true) {
    if (disposed) return Promise.resolve();
    generation += 1;
    const wasStarted = state.started;
    // AudioEngine detaches its output synchronously, before close() settles.
    const stopping = engine.stop({ notify: false });
    reset();
    if (notify && wasStarted) ports.onEnded();
    return stopping.catch(() => {});
  }

  function play(text: string) {
    if (disposed || !text.trim()) return;
    const currentGeneration = ++generation;
    const settings = normalizePlaybackSettings(ports.getSettings());
    try {
      const plan = buildAudioPlan(text, {
        ...settings,
        frequency: settings.freq
      });
      engine.play(plan);
      publish({ ...idlePlayback(text), started: true, plan });
      ports.onStart(settings);
    } catch {
      fail(currentGeneration);
    }
  }

  const unsubscribe = engine.subscribe((event) => {
    if (disposed || !state.started) return;
    if (event === 'error') {
      fail(generation);
      return;
    }
    if (event !== 'ended') return;
    generation += 1;
    reset();
    ports.onEnded();
  });

  return {
    play,
    stop,
    replaceText(text: string) {
      if (disposed || state.text === text) return;
      if (state.started) void stop();
      publish({ ...idlePlayback(text) });
    },
    async toggle(text: string) {
      if (disposed || state.busy) return;
      if (!state.started) {
        play(text);
        return;
      }
      const currentGeneration = generation;
      const paused = state.paused;
      publish({ ...state, busy: true });
      try {
        if (paused) await engine.resume();
        else await engine.pause();
        if (!disposed && currentGeneration === generation)
          publish({ ...state, paused: !paused, busy: false });
      } catch {
        fail(currentGeneration);
      }
    },
    skip() {
      const plan = state.plan;
      if (!state.started || !plan) return;
      const elapsed = Math.max(engine.elapsed() - plan.startDelay, 0);
      let nextTone = 0;
      let nextCharacter = 0;
      for (; nextCharacter < plan.text.length; nextCharacter += 1) {
        const symbolCount = MORSE[plan.text[nextCharacter]]?.length ?? 0;
        if (symbolCount && plan.events[nextTone]?.start > elapsed) break;
        nextTone += symbolCount;
      }
      if (nextCharacter === plan.text.length) {
        void stop();
        return;
      }
      // Preserve exact tone boundaries and the original settings for the tail.
      const offset = plan.events[nextTone].start;
      const tail = {
        ...plan,
        text: plan.text.slice(nextCharacter),
        startDelay: 0,
        totalDuration: plan.totalDuration - offset,
        events: plan.events
          .slice(nextTone)
          .map((event) => ({ ...event, start: event.start - offset }))
      };
      const currentGeneration = ++generation;
      try {
        engine.play(tail);
        publish({ ...idlePlayback(tail.text), started: true, plan: tail });
      } catch {
        fail(currentGeneration);
      }
    },
    update() {
      if (!state.started || !state.plan || disposed) return;
      const elapsed = Math.max(engine.elapsed(), 0);
      const duration = state.plan.totalDuration + state.plan.startDelay;
      publish({
        ...state,
        timer: elapsed - state.plan.startDelay,
        progress: duration > 0 ? Math.min(elapsed / duration, 1) : 1
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      unsubscribe();
      await engine.dispose().catch(() => {});
    }
  };
}

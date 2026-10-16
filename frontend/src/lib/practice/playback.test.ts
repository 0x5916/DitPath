import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine, AudioEngineEvent } from '../audio/engine';
import {
  createPlaybackController,
  idlePlayback,
  normalizePlaybackSettings,
  type PlaybackSettings,
  type PlaybackState
} from './playback';

function deferred() {
  let resolve = () => {};
  let reject = () => {};
  const promise = new Promise<void>((finish, fail) => {
    resolve = finish;
    reject = () => fail(new Error('audio unavailable'));
  });
  return { promise, resolve, reject };
}

function setup() {
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  let active = false;
  let elapsed = 0;
  const engine: AudioEngine = {
    play: vi.fn(() => {
      active = true;
      elapsed = 0;
    }),
    stop: vi.fn(async () => {
      active = false;
    }),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    dispose: vi.fn(async () => {
      active = false;
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isActive: () => active,
    isPaused: () => false,
    elapsed: () => elapsed
  };
  let state = idlePlayback();
  let settings = normalizePlaybackSettings({ startDelay: 1 });
  const onStart = vi.fn();
  const onEnded = vi.fn();
  const onChange = vi.fn((next: PlaybackState) => (state = next));
  const controller = createPlaybackController({
    engine,
    getSettings: () => settings,
    onChange,
    onStart,
    onEnded
  });
  return {
    controller,
    engine,
    onStart,
    onEnded,
    onChange,
    state: () => state,
    setElapsed: (seconds: number) => (elapsed = seconds),
    setSettings: (next: PlaybackSettings) => (settings = next),
    finish: () => listeners.forEach((listener) => listener('ended'))
  };
}

describe('playback settings boundary', () => {
  it('replaces blank, nonfinite and out-of-range settings with safe values', () => {
    expect(
      normalizePlaybackSettings({
        charWpm: Number.NaN,
        effWpm: Number.POSITIVE_INFINITY,
        freq: -1,
        volume: 4,
        startDelay: -2
      })
    ).toEqual({ charWpm: 20, effWpm: 12, freq: 300, volume: 1, startDelay: 0 });
  });

  it('keeps effective speed at or below character speed', () => {
    expect(normalizePlaybackSettings({ charWpm: 8, effWpm: 50 }).effWpm).toBe(8);
    expect(normalizePlaybackSettings({ charWpm: 0, effWpm: 0 })).toMatchObject({
      charWpm: 5,
      effWpm: 5
    });
  });
});

describe('practice playback controller', () => {
  it('keeps the UI and engine on the same plan, including the start delay', () => {
    const h = setup();
    h.controller.play('KM');
    expect(h.state().started).toBe(true);
    expect(h.engine.play).toHaveBeenCalledWith(h.state().plan);
    expect(h.onStart).toHaveBeenCalledWith(normalizePlaybackSettings({ startDelay: 1 }));
    h.controller.update();
    expect(h.state().timer).toBe(-1);
    h.setElapsed(2);
    h.controller.update();
    expect(h.state().timer).toBe(1);
    expect(h.state().progress).toBeCloseTo(2 / (h.state().plan!.totalDuration + 1));
  });

  it('does not start or unlock an empty prompt', () => {
    const h = setup();
    h.controller.play(' ');
    expect(h.engine.play).not.toHaveBeenCalled();
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('stops synchronously on exercise replacement while context shutdown is pending', async () => {
    const h = setup();
    const gate = deferred();
    vi.mocked(h.engine.stop).mockReturnValueOnce(gate.promise);
    h.controller.play('KM');
    h.controller.replaceText('R');
    expect(h.state()).toEqual(idlePlayback('R'));
    expect(h.engine.stop).toHaveBeenCalledWith({ notify: false });
    expect(h.onEnded).toHaveBeenCalledTimes(1);
    h.controller.play('R');
    gate.resolve();
    await gate.promise;
    expect(h.state().started).toBe(true);
    expect(h.state().plan?.text).toBe('R');
  });

  it('clears an engine start failure without unlocking an unplayed attempt and allows retry', () => {
    const h = setup();
    vi.mocked(h.engine.play).mockImplementationOnce(() => {
      throw new Error('cannot create AudioContext');
    });
    h.controller.play('KM');
    expect(h.state()).toMatchObject({ started: false, plan: null, failed: true });
    expect(h.engine.stop).toHaveBeenCalledWith({ notify: false });
    expect(h.onStart).not.toHaveBeenCalled();
    h.controller.play('KM');
    expect(h.state()).toMatchObject({ started: true, failed: false });
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it.each(['pause', 'resume'] as const)(
    'clears failed %s with visible idle error state',
    async (op) => {
      const h = setup();
      h.controller.play('KM');
      if (op === 'resume') await h.controller.toggle('KM');
      vi.mocked(h.engine[op]).mockRejectedValueOnce(new Error('audio interrupted'));
      await h.controller.toggle('KM');
      expect(h.state()).toMatchObject({ started: false, paused: false, plan: null, failed: true });
      expect(h.onEnded).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores a delayed pause %s after a replacement starts',
    async (outcome) => {
      const h = setup();
      const gate = deferred();
      h.controller.play('KM');
      vi.mocked(h.engine.pause).mockReturnValueOnce(gate.promise);
      const pending = h.controller.toggle('KM');
      expect(h.state().busy).toBe(true);
      await h.controller.toggle('KM');
      expect(h.engine.pause).toHaveBeenCalledTimes(1);
      h.controller.replaceText('R');
      h.controller.play('R');
      gate[outcome]();
      await pending;
      expect(h.state()).toMatchObject({ started: true, paused: false, busy: false, failed: false });
      expect(h.state().plan?.text).toBe('R');
    }
  );

  it('skips to a character boundary using the active plan and its original settings', () => {
    const h = setup();
    h.controller.play('K M');
    const original = h.state().plan!;
    h.setSettings(normalizePlaybackSettings({ freq: 900, volume: 0.2 }));
    h.setElapsed(1.1);
    h.controller.skip();
    const tail = h.state().plan!;
    expect(tail.text).toBe('M');
    expect(tail.events).toHaveLength(2);
    expect(tail.events[0].start).toBe(0);
    expect(tail).toMatchObject({
      frequency: original.frequency,
      volume: original.volume,
      startDelay: 0
    });
    expect(h.onStart).toHaveBeenCalledTimes(1);
    h.setElapsed(tail.totalDuration);
    h.controller.skip();
    expect(h.state().started).toBe(false);
    expect(h.onEnded).toHaveBeenCalledTimes(1);
  });

  it('finishes once and disposes without allowing stale events or pending updates', async () => {
    const h = setup();
    h.controller.play('K');
    h.finish();
    h.finish();
    expect(h.onEnded).toHaveBeenCalledTimes(1);
    h.controller.play('M');
    await h.controller.dispose();
    const changes = h.onChange.mock.calls.length;
    h.finish();
    h.controller.play('R');
    h.controller.update();
    expect(h.engine.dispose).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledTimes(changes);
    expect(h.onEnded).toHaveBeenCalledTimes(1);
  });
});

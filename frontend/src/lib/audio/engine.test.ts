import { describe, expect, it } from 'vitest';
import type { AudioEngine } from './engine';
import { createWebAudioEngine } from './engine';
import { buildAudioPlan } from '../training/timing';

type ParamCall = {
  method: 'setValueAtTime' | 'linearRampToValueAtTime';
  value: number;
  time: number;
};

class FakeParam {
  calls: ParamCall[] = [];

  constructor(public value = 0) {}

  setValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'setValueAtTime', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
  }
}

class FakeGainNode {
  gain = new FakeParam(1);
  connected: unknown = null;

  connect(target: unknown): void {
    this.connected = target;
  }

  disconnect(): void {
    this.connected = null;
  }
}

class FakeOscillatorNode {
  frequency = new FakeParam();
  started = false;
  stoppedAt: number | null = null;
  stopTimes: number[] = [];
  onended: (() => void) | null = null;
  connected: unknown = null;

  connect(target: unknown): void {
    this.connected = target;
  }

  disconnect(): void {
    this.connected = null;
  }

  start(): void {
    this.started = true;
  }

  stop(time = 0): void {
    this.stoppedAt = time;
    this.stopTimes.push(time);
  }
}

class FakeAudioContext {
  currentTime = 10;
  destination = { name: 'destination' };
  state = 'running';
  oscillators: FakeOscillatorNode[] = [];
  gains: FakeGainNode[] = [];
  closeCalls = 0;
  suspendCalls = 0;
  resumeCalls = 0;
  suspendGate: Promise<void> | null = null;
  resumeGate: Promise<void> | null = null;
  private closeGate: Promise<void> | null = null;
  finishClose: () => void = () => {};

  constructor(delayClose = false) {
    if (delayClose) {
      this.closeGate = new Promise((resolve) => {
        this.finishClose = resolve;
      });
    }
  }

  createOscillator(): FakeOscillatorNode {
    const osc = new FakeOscillatorNode();
    this.oscillators.push(osc);
    return osc;
  }

  createGain(): FakeGainNode {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeGate) await this.closeGate;
    this.state = 'closed';
  }

  async suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
    if (this.suspendGate) await this.suspendGate;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    if (this.resumeGate) await this.resumeGate;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function setup(delayClose = false) {
  const contexts: FakeAudioContext[] = [];
  const createContext = () => {
    const context = new FakeAudioContext(delayClose);
    contexts.push(context);
    return context as unknown as AudioContext;
  };
  const engine: AudioEngine = createWebAudioEngine({ createContext });
  return { contexts, createContext, engine };
}

const plan = buildAudioPlan('I', {
  charWpm: 20,
  effWpm: 10,
  frequency: 700,
  volume: 0.5,
  startDelay: 1
});

describe('WebAudioEngine', () => {
  it('creates the audio context only when play is called', () => {
    let created = 0;
    const engine = createWebAudioEngine({
      createContext: () => {
        created += 1;
        return new FakeAudioContext() as unknown as AudioContext;
      }
    });

    expect(created).toBe(0);
    engine.play(plan);
    expect(created).toBe(1);
  });

  it('schedules the plan on the audio timeline with gain ramps', () => {
    const { contexts, engine } = setup();
    engine.play(plan);

    const context = contexts[0];
    const osc = context.oscillators[0];
    expect(osc.frequency.value).toBe(700);
    expect(osc.started).toBe(true);
    expect(osc.stoppedAt).toBeCloseTo(10 + 1 + plan.totalDuration, 12);

    const calls = context.gains[0].gain.calls;
    // Silence starts now, before the delayed first tone, as in the original
    // player. A future initial step leaves the default gain audible until then.
    expect(calls).toHaveLength(1 + plan.events.length * 4);
    expect(calls[0]).toEqual({ method: 'setValueAtTime', value: 0, time: 10 });
    expect(calls[1]).toEqual({ method: 'setValueAtTime', value: 0, time: 11 });
    expect(calls[2].method).toBe('linearRampToValueAtTime');
    expect(calls[2].value).toBe(0.5);
    expect(calls[2].time).toBeCloseTo(11.005, 12);
    expect(calls[3].method).toBe('setValueAtTime');
    expect(calls[3].value).toBe(0.5);
    expect(calls[3].time).toBeCloseTo(11.055, 12);
    expect(calls[4].method).toBe('linearRampToValueAtTime');
    expect(calls[4].value).toBe(0);
    expect(calls[4].time).toBeCloseTo(11.06, 12);
    // Second tone starts after the symbol gap.
    expect(calls[5].time).toBeCloseTo(11.12, 12);
  });

  it('captures the playback clock after constructing the graph', () => {
    for (const startDelay of [0, 1]) {
      const context = new FakeAudioContext();
      const createGain = context.createGain.bind(context);
      context.createGain = () => {
        // Native audio time continues advancing while the graph is built.
        context.currentTime += 0.25;
        return createGain();
      };
      const engine = createWebAudioEngine({
        createContext: () => context as unknown as AudioContext
      });

      engine.play({ ...plan, startDelay });

      const calls = context.gains[0].gain.calls;
      expect(engine.elapsed()).toBe(0);
      expect(calls[0]).toEqual({ method: 'setValueAtTime', value: 0, time: 10.25 });
      expect(calls[1].time).toBe(10.25 + startDelay);
      expect(context.oscillators[0].stoppedAt).toBeCloseTo(
        10.25 + startDelay + plan.totalDuration,
        12
      );
    }
  });

  it('notifies ended exactly once when the oscillator finishes naturally', async () => {
    const { contexts, engine } = setup();
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));

    engine.play(plan);
    expect(engine.isActive()).toBe(true);
    contexts[0].oscillators[0].onended?.();
    await flush();

    expect(events).toEqual(['ended']);
    expect(engine.isActive()).toBe(false);
    expect(engine.elapsed()).toBe(0);
    expect(contexts[0].closeCalls).toBe(1);

    // A repeated callback from the same (stale) playback does nothing.
    contexts[0].oscillators[0].onended?.();
    await flush();
    expect(events).toEqual(['ended']);
  });

  it('ignores a stale completion from a playback replaced by a newer one', async () => {
    const { contexts, engine } = setup();
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));

    engine.play(plan);
    const staleOsc = contexts[0].oscillators[0];
    engine.play(plan);

    expect(contexts).toHaveLength(2);
    expect(contexts[0].closeCalls).toBe(1);
    expect(engine.isActive()).toBe(true);

    staleOsc.onended?.();
    await flush();
    expect(events).toEqual([]);
    expect(engine.isActive()).toBe(true);

    contexts[1].oscillators[0].onended?.();
    await flush();
    expect(events).toEqual(['ended']);
    expect(engine.isActive()).toBe(false);
  });

  it('detaches replaced audio before its context finishes closing', async () => {
    const { contexts, engine } = setup(true);
    engine.play(plan);
    const previous = contexts[0];
    const osc = previous.oscillators[0];

    engine.play(plan);

    expect(previous.state).toBe('running');
    expect(previous.closeCalls).toBe(1);
    expect(osc.onended).toBeNull();
    expect(osc.stopTimes).toHaveLength(2);
    expect(osc.stopTimes[1]).toBeLessThanOrEqual(previous.currentTime);
    expect(osc.connected).toBeNull();
    expect(previous.gains[0].connected).toBeNull();
    expect(contexts[1].gains[0].connected).toBe(contexts[1].destination);
    expect(engine.isActive()).toBe(true);

    previous.finishClose();
    const disposing = engine.dispose();
    contexts[1].finishClose();
    await disposing;
  });

  it('detaches audio synchronously on stop and dispose', async () => {
    for (const action of ['stop', 'dispose'] as const) {
      const { contexts, engine } = setup(true);
      const events: string[] = [];
      engine.subscribe((event) => events.push(event));
      engine.play(plan);
      const previous = contexts[0];

      const stopping = engine[action]();

      expect(engine.isActive()).toBe(false);
      expect(previous.state).toBe('running');
      expect(previous.oscillators[0].onended).toBeNull();
      expect(previous.oscillators[0].connected).toBeNull();
      expect(previous.gains[0].connected).toBeNull();
      expect(previous.oscillators[0].stopTimes[1]).toBeLessThanOrEqual(previous.currentTime);
      expect(events).toEqual([]);

      previous.finishClose();
      await stopping;
      expect(events).toEqual(action === 'stop' ? ['ended'] : []);
      await engine.dispose();
    }
  });

  it('does not emit a delayed natural completion after replay starts', async () => {
    const { contexts, engine } = setup(true);
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));
    engine.play(plan);
    contexts[0].oscillators[0].onended?.();

    engine.play(plan);
    contexts[0].finishClose();
    await flush();

    expect(events).toEqual([]);
    expect(engine.isActive()).toBe(true);
    contexts[1].oscillators[0].onended?.();
    contexts[1].finishClose();
    await flush();
    expect(events).toEqual(['ended']);
    await engine.dispose();
  });

  it('keeps only the newest graph connected during rapid replay', async () => {
    const { contexts, engine } = setup(true);
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));
    const staleCompletions: Array<(() => void) | null> = [];
    for (let index = 0; index < 5; index += 1) {
      engine.play(plan);
      staleCompletions.push(contexts[index].oscillators[0].onended);
    }

    for (const previous of contexts.slice(0, -1)) {
      expect(previous.oscillators[0].connected).toBeNull();
      expect(previous.gains[0].connected).toBeNull();
    }
    const latest = contexts.at(-1)!;
    expect(latest.oscillators[0].connected).toBe(latest.gains[0]);
    expect(latest.gains[0].connected).toBe(latest.destination);
    for (const complete of staleCompletions.slice(0, -1)) complete?.();
    for (const previous of contexts.slice(0, -1)) previous.finishClose();
    await flush();
    expect(events).toEqual([]);
    expect(engine.isActive()).toBe(true);

    latest.oscillators[0].onended?.();
    latest.finishClose();
    await flush();
    expect(events).toEqual(['ended']);
    expect(engine.isActive()).toBe(false);
    await engine.dispose();
  });

  it('stops idempotently and notifies once', async () => {
    const { contexts, engine } = setup();
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));

    engine.play(plan);
    await engine.stop();
    await engine.stop();

    expect(events).toEqual(['ended']);
    expect(engine.isActive()).toBe(false);
    expect(contexts[0].closeCalls).toBe(1);
  });

  it('supports a silent stop without notifying', async () => {
    const { contexts, engine } = setup();
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));

    engine.play(plan);
    await engine.stop({ notify: false });

    expect(events).toEqual([]);
    expect(engine.isActive()).toBe(false);
    expect(contexts[0].closeCalls).toBe(1);
  });

  it('suspends and resumes the timeline, and is safe while idle', async () => {
    const { contexts, engine } = setup();

    await engine.pause();
    await engine.resume();
    expect(engine.isPaused()).toBe(false);

    engine.play(plan);
    await engine.pause();
    expect(engine.isPaused()).toBe(true);
    expect(contexts[0].suspendCalls).toBe(1);

    await engine.pause();
    expect(contexts[0].suspendCalls).toBe(1);

    await engine.resume();
    expect(engine.isPaused()).toBe(false);
    expect(contexts[0].resumeCalls).toBe(1);

    await engine.resume();
    expect(contexts[0].resumeCalls).toBe(1);
  });

  it('ignores delayed suspension after replay, stop, or dispose', async () => {
    for (const action of ['replay', 'stop', 'dispose'] as const) {
      const { contexts, engine } = setup();
      engine.play(plan);
      const gate = deferred();
      contexts[0].suspendGate = gate.promise;
      const pausing = engine.pause();

      if (action === 'replay') engine.play(plan);
      else await engine[action]();
      gate.resolve();
      await pausing;

      expect(engine.isPaused()).toBe(false);
      expect(engine.isActive()).toBe(action === 'replay');
      if (action === 'replay') expect(contexts[1].state).toBe('running');
      await engine.dispose();
    }
  });

  it('ignores delayed resumption after the replacement playback is paused', async () => {
    const { contexts, engine } = setup();
    engine.play(plan);
    await engine.pause();
    const gate = deferred();
    contexts[0].resumeGate = gate.promise;
    const resuming = engine.resume();

    engine.play(plan);
    await engine.pause();
    gate.resolve();
    await resuming;

    expect(engine.isActive()).toBe(true);
    expect(engine.isPaused()).toBe(true);
    expect(contexts[1].state).toBe('suspended');
    await engine.dispose();
  });

  it('disposes silently, repeatedly, and blocks further playback', async () => {
    const { contexts, engine } = setup();
    const events: string[] = [];
    engine.subscribe((event) => events.push(event));

    engine.play(plan);
    await engine.dispose();

    expect(events).toEqual([]);
    expect(engine.isActive()).toBe(false);
    expect(contexts[0].closeCalls).toBe(1);

    await engine.dispose();
    engine.play(plan);
    expect(contexts).toHaveLength(1);
  });

  it('unsubscribes listeners and ignores subscriptions after disposal', async () => {
    const { contexts, engine } = setup();
    const events: string[] = [];
    const unsubscribe = engine.subscribe((event) => events.push(event));

    unsubscribe();
    engine.play(plan);
    contexts[0].oscillators[0].onended?.();
    await flush();
    expect(events).toEqual([]);

    await engine.dispose();
    const late = engine.subscribe((event) => events.push(event));
    late();
    expect(events).toEqual([]);
  });
});

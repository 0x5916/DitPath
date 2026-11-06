#!/usr/bin/env node
/**
 * Render DitPath's real Web Audio schedule offline and measure the signal.
 *
 * The frontend module is loaded through Vite's development server so the audit
 * uses the same `buildAudioPlan` and `createWebAudioEngine` code as the app.
 * Each browser renders into an OfflineAudioContext; no audio device or user
 * gesture is involved. The output is measurement evidence, not a substitute
 * for listening tests on real hardware.
 */
import { createServer } from 'vite';
import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifactDir = fileURLToPath(new URL('../../.artifacts/', import.meta.url));
const browsers = { chromium, firefox, webkit };
const selected = process.argv.slice(2);

process.env.PUBLIC_API_BASE ??= 'http://127.0.0.1:4173/v1';
process.env.PUBLIC_GOOGLE_CLIENT_ID ??= '';

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false }
});
await server.listen();
const baseURL = server.resolvedUrls?.local?.[0];
if (!baseURL) throw new Error('Vite did not expose a local URL');

async function browserAudit(type, launcher) {
  const browser = await launcher.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('/en', baseURL).href, { waitUntil: 'networkidle' });
    const result = await page.evaluate(renderAndMeasure);
    return { browser: type, ...result };
  } finally {
    await browser.close();
  }
}

/**
 * Browser-side audit. It deliberately uses the production timing/engine
 * modules through Vite rather than reimplementing their schedule.
 */
async function renderAndMeasure() {
  const { createWebAudioEngine, START_LEAD_IN, MIN_OUTPUT_TAIL } =
    await import('/src/lib/audio/engine.ts');
  const { buildAudioPlan, calculateDuration } = await import('/src/lib/training/timing.ts');

  const SAMPLE_RATE = 48_000;
  const CASES = [
    {
      name: 'A at 20/10 WPM',
      text: 'A',
      options: { charWpm: 20, effWpm: 10, frequency: 700, volume: 0.8, startDelay: 0.25 },
      role: 'dot, dash, and symbol gap'
    },
    {
      name: 'EE at 20/10 WPM',
      text: 'EE',
      options: { charWpm: 20, effWpm: 10, frequency: 600, volume: 0.8, startDelay: 0 },
      role: 'letter gap'
    },
    {
      name: 'E E at 20/10 WPM',
      text: 'E E',
      options: { charWpm: 20, effWpm: 10, frequency: 600, volume: 0.8, startDelay: 0 },
      role: 'word gap'
    },
    {
      name: 'PARIS at 20/10 WPM',
      text: 'PARIS ',
      options: { charWpm: 20, effWpm: 10, frequency: 600, volume: 0.8, startDelay: 0 },
      role: 'effective WPM over a complete word'
    },
    {
      name: 'S at 20/20 WPM',
      text: 'S',
      options: { charWpm: 20, effWpm: 20, frequency: 600, volume: 0.8, startDelay: 0 },
      role: 'final-dot tail and truncation'
    },
    {
      name: 'K at 50/50 WPM',
      text: 'K',
      options: { charWpm: 50, effWpm: 50, frequency: 850, volume: 0.8, startDelay: 0 },
      role: 'short elements and short fades'
    },
    {
      name: 'M at 5/5 WPM, full volume',
      text: 'M',
      options: { charWpm: 5, effWpm: 5, frequency: 300, volume: 1, startDelay: 0 },
      role: 'long dash, low tone, amplitude headroom'
    }
  ];

  function analyze(buffer, plan, thresholdRatio = 0.03) {
    const data = buffer.getChannelData(0);
    let peak = 0;
    let maxDelta = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
      if (i) maxDelta = Math.max(maxDelta, Math.abs(data[i] - data[i - 1]));
    }

    // A 0.5 ms RMS envelope is long enough to bridge sine zero crossings and
    // short enough to resolve a 24 ms dot at 50 WPM.
    const block = Math.max(1, Math.round(SAMPLE_RATE * 0.0005));
    const envelope = [];
    for (let start = 0; start < data.length; start += block) {
      let sum = 0;
      const end = Math.min(data.length, start + block);
      for (let i = start; i < end; i += 1) sum += data[i] * data[i];
      envelope.push(Math.sqrt(sum / (end - start)));
    }
    const threshold = Math.max(0.0015, peak * thresholdRatio);
    const runs = [];
    let runStart = null;
    for (let index = 0; index < envelope.length; index += 1) {
      const active = envelope[index] >= threshold;
      if (active && runStart === null) runStart = index;
      if (!active && runStart !== null) {
        runs.push({
          start: (runStart * block) / SAMPLE_RATE,
          end: (index * block) / SAMPLE_RATE
        });
        runStart = null;
      }
    }
    if (runStart !== null) {
      runs.push({ start: (runStart * block) / SAMPLE_RATE, end: data.length / SAMPLE_RATE });
    }

    const tones = runs.map((run) => {
      const first = Math.max(0, Math.floor(run.start * SAMPLE_RATE));
      const last = Math.min(data.length - 1, Math.ceil(run.end * SAMPLE_RATE));
      let runPeak = 0;
      for (let i = first; i <= last; i += 1) runPeak = Math.max(runPeak, Math.abs(data[i]));

      // Measure frequency away from the gain ramps, using upward zero crossings.
      const trim = Math.max(1, Math.round((last - first) * 0.2));
      const from = first + trim;
      const to = last - trim;
      const crossings = [];
      for (let i = from + 1; i <= to; i += 1) {
        if (data[i - 1] <= 0 && data[i] > 0) crossings.push(i);
      }
      let frequency = null;
      if (crossings.length >= 2) {
        frequency = ((crossings.length - 1) * SAMPLE_RATE) / (crossings.at(-1) - crossings[0]);
      }

      // 10–90% rise measured from the envelope, a click indicator rather than
      // a perceptual rating.
      const local = envelope.slice(
        Math.max(0, Math.floor(run.start / (block / SAMPLE_RATE))),
        Math.ceil(run.end / (block / SAMPLE_RATE))
      );
      const high = Math.max(...local) * 0.9;
      const low = Math.max(...local) * 0.1;
      const lowIndex = local.findIndex((value) => value >= low);
      const highIndex = local.findIndex((value) => value >= high);
      const riseMs =
        lowIndex >= 0 && highIndex > lowIndex
          ? ((highIndex - lowIndex) * block * 1000) / SAMPLE_RATE
          : null;

      return {
        start: run.start,
        end: run.end,
        duration: run.end - run.start,
        peak: runPeak,
        frequency,
        riseMs
      };
    });

    const gaps = tones.slice(1).map((tone, index) => tone.start - tones[index].end);
    return {
      peak,
      maxDelta,
      clippedSamples: data.reduce((count, value) => count + (Math.abs(value) > 1.00001 ? 1 : 0), 0),
      tones,
      gaps
    };
  }

  function render(plan, expectedTail = MIN_OUTPUT_TAIL) {
    const duration = START_LEAD_IN + plan.startDelay + plan.totalDuration + expectedTail + 0.1;
    const offline = new OfflineAudioContext(1, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
    const context = {
      currentTime: 0,
      destination: offline.destination,
      state: 'running',
      baseLatency: 0,
      outputLatency: 0,
      createOscillator: () => offline.createOscillator(),
      createGain: () => offline.createGain(),
      async close() {},
      async resume() {},
      async suspend() {}
    };
    const engine = createWebAudioEngine({ createContext: () => context });
    engine.play(plan);
    return offline.startRendering().then((buffer) => {
      void engine.dispose();
      return buffer;
    });
  }

  const measurements = [];
  for (const testCase of CASES) {
    const plan = buildAudioPlan(testCase.text, testCase.options);
    const duration = calculateDuration(
      testCase.text,
      testCase.options.charWpm,
      testCase.options.effWpm
    );
    const buffer = await render(plan);
    const signal = analyze(buffer, plan);
    const expectedTones = plan.events.map((event) => ({
      start: START_LEAD_IN + plan.startDelay + event.start,
      duration: event.duration
    }));
    const expectedGaps = plan.events.slice(1).map((event, index) => {
      const previous = plan.events[index];
      return event.start - (previous.start + previous.duration);
    });
    measurements.push({
      name: testCase.name,
      role: testCase.role,
      plan: {
        text: plan.text,
        totalDuration: plan.totalDuration,
        calculatedDuration: duration,
        startDelay: plan.startDelay,
        fade: plan.fade,
        frequency: plan.frequency,
        volume: plan.volume,
        events: plan.events
      },
      expected: { tones: expectedTones, gaps: expectedGaps },
      measured: signal,
      effectiveWpm: 60 / duration
    });
  }

  // Repeat one render to detect nondeterministic scheduling in the measurement
  // path. Real playback consistency still requires device listening.
  const repeated = [];
  const repeatPlan = buildAudioPlan('A', {
    charWpm: 20,
    effWpm: 10,
    frequency: 700,
    volume: 0.8,
    startDelay: 0.25
  });
  for (let index = 0; index < 3; index += 1) {
    repeated.push(analyze(await render(repeatPlan), repeatPlan));
  }

  return {
    sampleRate: SAMPLE_RATE,
    minOutputTail: MIN_OUTPUT_TAIL,
    startLeadIn: START_LEAD_IN,
    measurements,
    repeated
  };
}

function verify(result) {
  const failures = [];
  const tolerance = 0.002;
  const close = (actual, expected, limit, label) => {
    if (actual === null || !Number.isFinite(actual) || Math.abs(actual - expected) > limit) {
      failures.push(`${result.browser}: ${label} expected ${expected}, measured ${actual}`);
    }
  };

  for (const measurement of result.measurements) {
    const { name, expected, measured, plan, effectiveWpm } = measurement;
    if (measured.tones.length !== expected.tones.length) {
      failures.push(
        `${result.browser}: ${name} expected ${expected.tones.length} tones, found ${measured.tones.length}`
      );
      continue;
    }
    expected.tones.forEach((tone, index) => {
      close(measured.tones[index].start, tone.start, tolerance, `${name} tone ${index + 1} start`);
      close(
        measured.tones[index].duration,
        tone.duration,
        tolerance,
        `${name} tone ${index + 1} duration`
      );
    });
    expected.gaps.forEach((gap, index) => {
      close(measured.gaps[index], gap, tolerance, `${name} gap ${index + 1}`);
      if (gap >= 0 && measured.gaps[index] < -tolerance) {
        failures.push(`${result.browser}: ${name} has overlapping tones`);
      }
    });
    close(
      measured.tones[0]?.frequency ?? null,
      plan.frequency,
      Math.max(2, plan.frequency * 0.005),
      `${name} frequency`
    );
    if (Math.abs(measured.peak - plan.volume) > 0.01) {
      failures.push(
        `${result.browser}: ${name} peak ${measured.peak.toFixed(4)} does not match volume ${plan.volume}`
      );
    }
    if (measured.peak > 1.0001 || measured.clippedSamples > 0) {
      failures.push(`${result.browser}: ${name} clamps or clips samples`);
    }
    const theoreticalDelta = (2 * Math.PI * plan.frequency * plan.volume) / 48_000;
    if (measured.maxDelta > theoreticalDelta * 1.6 + 0.02) {
      failures.push(
        `${result.browser}: ${name} sample discontinuity ${measured.maxDelta.toFixed(4)} suggests a click`
      );
    }
    if (name.startsWith('PARIS')) {
      close(effectiveWpm, 10, 0.01, `${name} effective WPM`);
    }
    if (name.startsWith('S at')) {
      const lastExpected = expected.tones.at(-1);
      const lastMeasured = measured.tones.at(-1);
      if (Math.abs(lastMeasured.end - (lastExpected.start + lastExpected.duration)) > tolerance) {
        failures.push(`${result.browser}: ${name} final dot is truncated`);
      }
    }
  }

  const reference = result.repeated[0];
  for (const [index, sample] of result.repeated.entries()) {
    if (Math.abs(sample.tones[0]?.start - reference.tones[0]?.start) > tolerance) {
      failures.push(`${result.browser}: repeat ${index + 1} starts inconsistently`);
    }
    if (Math.abs(sample.tones[0]?.duration - reference.tones[0]?.duration) > tolerance) {
      failures.push(`${result.browser}: repeat ${index + 1} durations differ`);
    }
  }
  return failures;
}

const requested = selected.length ? selected : Object.keys(browsers);
const results = [];
const allFailures = [];
for (const type of requested) {
  const launcher = browsers[type];
  if (!launcher) {
    allFailures.push(`Unknown browser "${type}"; choose ${Object.keys(browsers).join(', ')}`);
    continue;
  }
  try {
    const result = await browserAudit(type, launcher);
    const failures = verify(result);
    allFailures.push(...failures);
    results.push({ ...result, passed: failures.length === 0, failures });
    const rows = result.measurements.map((measurement) => {
      const tone = measurement.measured.tones[0];
      const gap = measurement.measured.gaps[0];
      return {
        case: measurement.name,
        tones: measurement.measured.tones.length,
        firstToneMs: tone ? +(tone.start * 1000).toFixed(2) : null,
        firstDurationMs: tone ? +(tone.duration * 1000).toFixed(2) : null,
        firstFrequencyHz: tone?.frequency ? +tone.frequency.toFixed(2) : null,
        firstGapMs: gap === undefined ? null : +(gap * 1000).toFixed(2),
        peak: +measurement.measured.peak.toFixed(4),
        effectiveWpm: +measurement.effectiveWpm.toFixed(3)
      };
    });
    console.log(`\n${type}`);
    console.table(rows);
  } catch (error) {
    allFailures.push(`${type}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await mkdir(artifactDir, { recursive: true });
const artifact = {
  generatedAt: new Date().toISOString(),
  commit: process.env.SOURCE_REVISION ?? null,
  baseURL,
  browsers: requested,
  passed: allFailures.length === 0,
  failures: allFailures,
  results
};
const artifactPath = path.join(artifactDir, 'audio-audit.json');
await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`\n${allFailures.length ? 'FAIL' : 'PASS'} — ${artifactPath}`);
if (allFailures.length) {
  for (const failure of allFailures) console.error(`- ${failure}`);
}
await server.close();
process.exitCode = allFailures.length ? 1 : 0;

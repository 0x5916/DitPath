import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb
} from '../data/learning-evidence';
import { createEvidenceAudioEngine } from './evidence-engine';
import type { AudioEngine, AudioEngineEvent } from './engine';
import { buildAudioPlan } from '../training/timing';
import { anchoredClock, priorExposure } from '../learning-evidence/exposure';
const databases: IDBDatabase[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
});
async function fixture() {
  const db = await openLearningEvidenceDb(new IDBFactory());
  databases.push(db);
  const repo = createLearningEvidenceRepository(db, 'unclaimed');
  let active = false;
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const base: AudioEngine = {
    play: vi.fn(() => {
      active = true;
    }),
    prepare: vi.fn(async () => {}),
    stop: vi.fn(async () => {
      active = false;
    }),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    isActive: () => active,
    isPaused: () => false,
    elapsed: () => 0,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
  const engine = createEvidenceAudioEngine({
    source: 'reference',
    repository: repo,
    base,
    currentOwner: () => 'unclaimed'
  });
  return {
    repo,
    base,
    engine,
    finish: () => {
      active = false;
      for (const fn of listeners) fn('ended');
    }
  };
}
const plan = buildAudioPlan('K', { charWpm: 20, effWpm: 12 });
describe('durable audio exposure', () => {
  it('commits the guard before tones and the closure before end notification', async () => {
    const f = await fixture();
    let release!: () => void;
    const append = f.repo.append.bind(f.repo);
    vi.spyOn(f.repo, 'append').mockImplementationOnce(async (records) => {
      await new Promise<void>((r) => (release = r));
      await append(records);
    });
    const events: string[] = [];
    f.engine.subscribe((event) => events.push(event));
    f.engine.play(plan);
    const first = f.engine.presentation();
    expect(first?.id).toBeTruthy();
    expect(f.base.prepare).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(f.base.play).not.toHaveBeenCalled();
    release();
    await f.engine.flush();
    expect(f.base.play).toHaveBeenCalledOnce();
    expect((await f.repo.all()).map((r) => r.kind)).toEqual(['exposure-open']);
    f.finish();
    await f.engine.flush();
    expect(events).toEqual(['ended']);
    expect(first?.valid).toBe(true);
    expect((await f.repo.all()).map((r) => r.kind)).toEqual(['exposure-open', 'exposure-close']);
    await f.engine.dispose();
  });
  it('does not let a stale pending play suppress the replacement completion', async () => {
    const f = await fixture();
    f.engine.play(plan);
    const first = f.engine.presentation();
    f.engine.play(buildAudioPlan('M', { charWpm: 20, effWpm: 12 }));
    const events: string[] = [];
    f.engine.subscribe((event) => events.push(event));
    await f.engine.flush();
    expect(first?.interrupted).toBe(true);
    expect(f.base.play).toHaveBeenCalledOnce();
    f.finish();
    await f.engine.flush();
    expect(events).toEqual(['ended']);
    await f.engine.dispose();
  });
  it('keeps an interrupted first sound invalid after a successful replay', async () => {
    const f = await fixture();
    f.engine.play(plan);
    await f.engine.flush();
    const first = f.engine.presentation();
    await f.engine.pause();
    await f.engine.stop({ notify: false });
    f.engine.play(plan);
    await f.engine.flush();
    f.finish();
    await f.engine.flush();
    expect(first).toMatchObject({ valid: false, interrupted: true });
    expect(f.engine.presentation()?.valid).toBe(true);
    await f.engine.dispose();
  });
  it('does not play when persistence fails and can retry without losing the guard', async () => {
    const f = await fixture();
    vi.spyOn(f.repo, 'append').mockRejectedValueOnce(new Error('disk full'));
    f.engine.play(plan);
    await expect(f.engine.flush()).rejects.toThrow('disk full');
    expect(f.base.play).not.toHaveBeenCalled();
    f.engine.play(plan);
    await f.engine.flush();
    expect(f.base.play).toHaveBeenCalledOnce();
    const records = await f.repo.all();
    expect(records.filter((r) => r.kind === 'exposure-open')).toHaveLength(2);
    expect(records.filter((r) => r.kind === 'exposure-close')).toHaveLength(1);
    await f.engine.dispose();
  });
  it('retains an unresolved guard when the clock becomes uncertain', async () => {
    const f = await fixture();
    const clock = vi.fn(
      () =>
        ({
          earliest: '2026-10-27T00:00:00Z',
          latest: '2026-10-27T00:00:01Z',
          source: 'monotonic-anchored' as const
        }) as ReturnType<ReturnType<typeof anchoredClock>>
    );
    const engine = createEvidenceAudioEngine({
      source: 'reference',
      repository: f.repo,
      base: f.base,
      clock,
      currentOwner: () => 'unclaimed'
    });
    engine.play(plan);
    await engine.flush();
    clock.mockReturnValue(null);
    await expect(engine.stop({ notify: false })).rejects.toThrow('clock');
    expect((await f.repo.all()).map((r) => r.kind)).toEqual(['exposure-open']);
    await engine.dispose();
  });
  it('treats wall-clock jumps and unresolved relevant sounds as unknown', () => {
    let wall = 10000,
      mono = 0;
    const clock = anchoredClock(
      () => wall,
      () => mono
    );
    expect(clock()?.source).toBe('monotonic-anchored');
    mono = 20;
    wall += 5000;
    expect(clock()).toBeNull();
    expect(
      priorExposure(
        [
          {
            id: 'open',
            kind: 'exposure-open',
            policy_version: 'learning-policy-1.0',
            recorded_at: '2026-10-27T00:00:00Z',
            characters: ['K'],
            started_at: null
          }
        ],
        'K',
        Date.now()
      )
    ).toBeNull();
  });
});

it('bounds a suspended preparation and retains its canonical first-delivery dependency', async () => {
  const f = await fixture();
  vi.mocked(f.base.prepare!).mockImplementationOnce(() => new Promise(() => {}));
  const engine = createEvidenceAudioEngine({
    source: 'reference',
    repository: f.repo,
    base: f.base,
    currentOwner: () => 'unclaimed',
    prepareTimeoutMs: 5
  });
  engine.play(plan);
  const first = engine.presentation()!;
  await expect(engine.flush()).rejects.toThrow('preparation timed out');
  expect(f.base.play).not.toHaveBeenCalled();
  const records = await f.repo.all();
  expect(records.find((r) => r.kind === 'exposure-open')).toMatchObject({
    presentation_id: first.id
  });
  expect(records.find((r) => r.kind === 'exposure-close')).toMatchObject({ end_reason: 'stopped' });
  expect(first).toMatchObject({ valid: false, interrupted: true });
  await engine.dispose();
});

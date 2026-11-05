import { describe, expect, it } from 'vitest';
import { placeFloatingPanel } from './floating-panel';

const viewport = { width: 1_000, height: 800 };
const panel = { width: 320, height: 180 };

function place(anchor: { top: number; right: number; bottom: number; left: number }, gap?: number) {
  return placeFloatingPanel({ anchor, panel, viewport, gap });
}

describe('placeFloatingPanel', () => {
  it('opens below the trigger when the lower half has room', () => {
    expect(place({ top: 100, right: 400, bottom: 140, left: 200 })).toEqual({
      left: 200,
      top: 144
    });
  });

  it('honours a larger gap for heading controls', () => {
    expect(place({ top: 100, right: 400, bottom: 140, left: 200 }, 8)?.top).toBe(148);
  });

  it('flips above the trigger near the bottom edge', () => {
    expect(place({ top: 700, right: 400, bottom: 740, left: 200 })).toEqual({
      left: 200,
      top: 516
    });
  });

  it('clamps horizontally into the viewport', () => {
    expect(place({ top: 100, right: 20, bottom: 140, left: -100 })?.left).toBe(16);
    expect(place({ top: 100, right: 900, bottom: 140, left: 800 })?.left).toBe(664);
  });

  it('keeps the panel inside a viewport narrower than the panel', () => {
    const narrow = placeFloatingPanel({
      anchor: { top: 100, right: 100, bottom: 140, left: 20 },
      panel: { width: 600, height: 180 },
      viewport: { width: 375, height: 800 }
    });
    expect(narrow?.left).toBe(16);
  });

  it('dismisses when the trigger has scrolled out of view', () => {
    expect(place({ top: -200, right: 400, bottom: -160, left: 200 })).toBeNull();
    expect(place({ top: 900, right: 400, bottom: 940, left: 200 })).toBeNull();
    expect(place({ top: 100, right: -20, bottom: 140, left: -100 })).toBeNull();
    expect(place({ top: 100, right: 1_100, bottom: 140, left: 1_050 })).toBeNull();
  });
});

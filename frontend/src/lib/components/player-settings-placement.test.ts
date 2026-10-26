import { describe, expect, it } from 'vitest';
import { computeSettingsPlacement, type SettingsPlacementInput } from './player-settings-placement';

function input(overrides: Partial<SettingsPlacementInput> = {}): SettingsPlacementInput {
  return {
    viewport: { top: 0, bottom: 800, left: 0, right: 1000 },
    trigger: { top: 0, bottom: 40, left: 800, right: 840 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    chrome: { topBar: 0, nav: 0 },
    margin: 16,
    gap: 8,
    narrowWidth: 224,
    wideWidth: 320,
    contentHeight: 300,
    ...overrides
  };
}

describe('computeSettingsPlacement', () => {
  it('keeps translated controls readable when no side fits the whole panel', () => {
    const placement = computeSettingsPlacement(
      input({
        viewport: { top: 0, bottom: 740, left: 0, right: 320 },
        trigger: { top: 322, bottom: 370, left: 170, right: 304 },
        chrome: { topBar: 0, nav: 52 },
        contentHeight: 488
      })
    );
    // Use the 224px CSS width and scroll inside the available vertical space,
    // rather than narrowing to 146px and overflowing after text reflows.
    expect(placement).toEqual({
      top: '16px',
      left: '80px',
      width: null,
      maxHeight: '298px'
    });
  });

  it('opens a right-aligned trigger to the left when that side fits the panel', () => {
    expect(computeSettingsPlacement(input())).toEqual({
      top: '16px',
      left: '472px',
      width: '320px',
      maxHeight: 'none'
    });
  });

  it('keeps the panel inside the safe band with a bottom tab bar', () => {
    expect(
      computeSettingsPlacement(
        input({
          viewport: { top: 0, bottom: 600, left: 0, right: 320 },
          trigger: { top: 500, bottom: 544, left: 8, right: 48 },
          safe: { top: 0, right: 0, bottom: 20, left: 0 },
          chrome: { topBar: 0, nav: 56 },
          contentHeight: 200
        })
      )
    ).toEqual({
      top: '328px',
      left: '56px',
      width: '248px',
      maxHeight: 'none'
    });
  });

  it('places a narrow trigger above itself and keeps the narrow width', () => {
    expect(
      computeSettingsPlacement(
        input({
          viewport: { top: 0, bottom: 600, left: 0, right: 320 },
          trigger: { top: 500, bottom: 544, left: 100, right: 200 },
          safe: { top: 0, right: 0, bottom: 20, left: 0 },
          chrome: { topBar: 0, nav: 56 },
          contentHeight: 200
        })
      )
    ).toEqual({
      top: '292px',
      left: '16px',
      width: null,
      maxHeight: 'none'
    });
  });

  it('caps a panel taller than the usable band and scrolls its content', () => {
    expect(
      computeSettingsPlacement(
        input({
          viewport: { top: 0, bottom: 600, left: 0, right: 320 },
          trigger: { top: 500, bottom: 544, left: 100, right: 200 },
          safe: { top: 0, right: 0, bottom: 20, left: 0 },
          chrome: { topBar: 0, nav: 56 },
          contentHeight: 600
        })
      )
    ).toEqual({
      top: '16px',
      left: '16px',
      width: null,
      maxHeight: '476px'
    });
  });
});

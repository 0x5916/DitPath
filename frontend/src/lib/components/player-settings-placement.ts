/**
 * Geometry for MorsePlayer's settings popover.
 *
 * The component owns DOM measurement; this module owns the placement math so
 * every side/clamping rule can be unit tested without a browser.
 */

export interface SettingsPlacement {
  top: string;
  left: string;
  width: string | null;
  maxHeight: string;
}

export interface SettingsPlacementInput {
  /** Visual viewport, or the window viewport when VisualViewport is unavailable. */
  viewport: { top: number; bottom: number; left: number; right: number };
  trigger: { top: number; bottom: number; left: number; right: number };
  /** Device safe-area insets in pixels. */
  safe: { top: number; right: number; bottom: number; left: number };
  /** Sticky top bar and fixed bottom tab bar heights; zero when hidden. */
  chrome: { topBar: number; nav: number };
  /** Breathing edge between the panel and the safe viewport band. */
  margin: number;
  /** Distance between the trigger and the panel. */
  gap: number;
  /** Popover widths for vertical and horizontal placements, before band clamping. */
  narrowWidth: number;
  wideWidth: number;
  contentHeight: number;
}

/**
 * Place the panel on whichever side of its trigger has the most usable room.
 * Left, right, above and below are measured against the safe viewport band;
 * the side that can show the whole panel at a workable width wins, and when no
 * side can, the largest one wins and only the panel's inner content scrolls.
 * Horizontal sides spread toward the free edge, vertical sides keep the narrow
 * width.
 */
export function computeSettingsPlacement(input: SettingsPlacementInput): SettingsPlacement {
  const { viewport, trigger, safe, chrome, margin, gap, contentHeight } = input;

  // The safe viewport band: visual viewport minus page chrome, device
  // safe-area insets and a breathing edge. Every placement is clamped into it,
  // so the panel stays on screen even when its trigger has been scrolled away.
  const topEdge = chrome.topBar > 0 ? chrome.topBar + margin : Math.max(margin, safe.top);
  const bottomEdge = chrome.nav > 0 ? chrome.nav + margin : Math.max(margin, safe.bottom);
  const usableLeft = viewport.left + Math.max(margin, safe.left);
  const usableRight = viewport.right - Math.max(margin, safe.right);
  const usableTop = viewport.top + topEdge;
  const usableBottom = viewport.bottom - bottomEdge;
  const bandWidth = Math.max(usableRight - usableLeft, 0);
  const bandHeight = Math.max(usableBottom - usableTop, 0);
  const narrowWidth = Math.min(input.narrowWidth, bandWidth);
  const wideWidth = Math.min(input.wideWidth, bandWidth);

  // Room each side can offer the panel itself, between it and the safe edges.
  const room = {
    left: Math.max(trigger.left - gap - usableLeft, 0),
    right: Math.max(usableRight - trigger.right - gap, 0),
    above: Math.max(trigger.top - gap - usableTop, 0),
    below: Math.max(usableBottom - trigger.bottom - gap, 0)
  };

  // Horizontal placements spread toward the free edge up to the wide ceiling;
  // vertical ones keep the narrow width. Every side is capped by the band
  // itself, so a trigger scrolled out of view cannot inflate the room.
  const widthOf = (side: keyof typeof room) =>
    side === 'left' || side === 'right' ? Math.min(room[side], wideWidth) : narrowWidth;
  const heightOf = (side: keyof typeof room) =>
    side === 'left' || side === 'right'
      ? Math.min(contentHeight, bandHeight)
      : Math.min(contentHeight, room[side], bandHeight);

  const sides = ['left', 'below', 'above', 'right'] as const;
  const wholePanel = (side: (typeof sides)[number]) =>
    widthOf(side) >= narrowWidth && heightOf(side) >= contentHeight;
  const fitting = sides.filter(wholePanel);
  // Preserve readable form width when no side fits the full height. Shrinking
  // horizontally reflows labels after measurement and can push controls offscreen.
  const pool = fitting.length > 0 ? fitting : sides.filter((side) => widthOf(side) >= narrowWidth);

  // Largest usable area wins; the order above breaks ties, so this
  // right-aligned trigger opens to its left whenever that side has the room.
  let side: (typeof sides)[number] = pool[0];
  let area = 0;
  for (const candidate of pool) {
    const candidateArea = widthOf(candidate) * heightOf(candidate);
    if (candidateArea > area) {
      area = candidateArea;
      side = candidate;
    }
  }

  const width = Math.round(widthOf(side));
  const height = Math.round(heightOf(side));
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));

  // Horizontal: line the panel up with the trigger, then clamp it into the
  // band. Vertical: sit above or below the trigger and clamp the same way.
  const top =
    side === 'left' || side === 'right'
      ? clamp(trigger.top, usableTop, usableBottom - height)
      : clamp(
          side === 'above' ? trigger.top - gap - height : trigger.bottom + gap,
          usableTop,
          usableBottom - height
        );
  const left =
    side === 'left'
      ? clamp(trigger.left - gap - width, usableLeft, usableRight - width)
      : side === 'right'
        ? clamp(trigger.right + gap, usableLeft, usableRight - width)
        : clamp(trigger.right - width, usableLeft, usableRight - width);

  return {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: side === 'left' || side === 'right' ? `${width}px` : null,
    maxHeight: contentHeight <= height ? 'none' : `${Math.floor(height)}px`
  };
}

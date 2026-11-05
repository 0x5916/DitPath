/** The minimum geometry needed to keep a floating panel near its trigger. */
interface FloatingAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface FloatingBounds {
  width: number;
  height: number;
}

interface FloatingViewport {
  width: number;
  height: number;
}

interface FloatingPlacement {
  left: number;
  top: number;
}

interface PlaceFloatingPanelOptions {
  anchor: FloatingAnchor;
  panel: FloatingBounds;
  viewport: FloatingViewport;
  /** Distance between the trigger and the panel. */
  gap?: number;
}

const VIEWPORT_MARGIN = 16;

/**
 * Place a fixed-position panel below its trigger, flipping above when the
 * lower half has no room and clamping horizontally into the viewport.
 * Returns `null` when the trigger has scrolled out of view.
 */
export function placeFloatingPanel({
  anchor,
  panel,
  viewport,
  gap = 4
}: PlaceFloatingPanelOptions): FloatingPlacement | null {
  if (
    anchor.bottom <= 0 ||
    anchor.top >= viewport.height ||
    anchor.right <= 0 ||
    anchor.left >= viewport.width
  )
    return null;

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - panel.width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(anchor.left, VIEWPORT_MARGIN), maxLeft);
  const below = anchor.bottom + gap + panel.height;
  const top =
    below <= viewport.height - VIEWPORT_MARGIN
      ? anchor.bottom + gap
      : Math.max(VIEWPORT_MARGIN, anchor.top - gap - panel.height);

  return { left, top };
}

import type { EvidenceRecord } from '../data/learning-evidence';
import type { TimeBounds } from '../training/learning-policy/types';
export type WireBounds = TimeBounds;
/** Round wire precision outwards so sub-millisecond server times cannot invent a gap. */
export function wireBounds(value: unknown): WireBounds | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  if (
    typeof b.earliest !== 'string' ||
    typeof b.latest !== 'string' ||
    !['monotonic-anchored', 'wall-clock-bounded'].includes(String(b.source))
  )
    return null;
  const earliest = Date.parse(b.earliest),
    latest = Date.parse(b.latest);
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) return null;
  const fraction = b.latest.match(/\.(\d+)/)?.[1] ?? '';
  const upper = latest + Number(/[1-9]/.test(fraction.slice(3)));
  return {
    earliest: new Date(earliest).toISOString(),
    latest: new Date(upper).toISOString(),
    source: b.source as WireBounds['source']
  };
}
/** Uses all recorded modes. An unresolved action prevents a precise later gap. */
export function priorExposure(
  records: readonly EvidenceRecord[],
  character: string,
  before: number
): WireBounds | null {
  const closes = new Map<string, EvidenceRecord>();
  for (const r of records)
    if (r.kind === 'exposure-close' && typeof r.open_id === 'string') closes.set(r.open_id, r);
  let latest: WireBounds | null = null;
  for (const r of records) {
    if (
      r.kind !== 'exposure-open' ||
      !Array.isArray(r.characters) ||
      !r.characters.includes(character)
    )
      continue;
    const start = wireBounds(r.started_at);
    if (start && Date.parse(start.earliest) >= before) continue;
    const close = closes.get(r.id);
    const end = wireBounds(
      (close?.last_exposure as Record<string, unknown> | undefined)?.[character]
    );
    if (!end || !Number.isFinite(Date.parse(end.latest))) return null;
    if (Date.parse(end.latest) >= before) return null;
    if (!latest || Date.parse(end.latest) > Date.parse(latest.latest)) latest = end;
  }
  return latest;
}
export function anchoredClock(
  wall: () => number = Date.now,
  monotonic: () => number = () => performance.now()
) {
  const epoch = wall(),
    origin = monotonic();
  return () => {
    const estimate = epoch + monotonic() - origin;
    const observed = wall();
    if (
      !Number.isFinite(estimate) ||
      !Number.isFinite(observed) ||
      Math.abs(observed - estimate) > 2000
    )
      return null;
    return {
      earliest: new Date(Math.floor(Math.min(estimate, observed) - 1)).toISOString(),
      latest: new Date(Math.ceil(Math.max(estimate, observed) + 1)).toISOString(),
      source: 'monotonic-anchored' as const
    };
  };
}

/** Rebuild a historical gap from all modes, excluding only the probe's own action.
 * Any action that could overlap the first tone conservatively prevents a cold pass.
 */
export function exposureBeforeProbe(
  records: readonly EvidenceRecord[],
  character: string,
  presentationId: string,
  first: WireBounds | null
): WireBounds | null {
  if (!first) return null;
  const limit = Date.parse(first.latest);
  const closes = new Map(
    records.filter((r) => r.kind === 'exposure-close').map((r) => [r.open_id, r])
  );
  let latest: WireBounds | null = null;
  for (const record of records) {
    if (
      record.kind !== 'exposure-open' ||
      record.presentation_id === presentationId ||
      !Array.isArray(record.characters) ||
      !record.characters.includes(character)
    )
      continue;
    const start = wireBounds(record.started_at);
    if (start && Date.parse(start.earliest) > limit) continue;
    const end = wireBounds(
      (closes.get(record.id)?.last_exposure as Record<string, unknown> | undefined)?.[character]
    );
    if (!end || !Number.isFinite(Date.parse(end.latest))) return null;
    if (!latest || Date.parse(end.latest) > Date.parse(latest.latest)) latest = end;
  }
  return latest;
}

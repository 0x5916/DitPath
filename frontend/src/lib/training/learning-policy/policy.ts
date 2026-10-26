/** Frozen pilot parameters; version independently of storage and wire schemas. */
export const LEARNING_POLICY = Object.freeze({
  version: 'learning-policy-1.0',
  opportunitiesPerTarget: 10,
  successesPerCheck: 9,
  proficiencyChecks: 2,
  freshnessMs: 14 * 86_400_000,
  coldGapMs: 20 * 3_600_000,
  retentionSpanMs: 7 * 86_400_000,
  reviewIntervalsMs: Object.freeze([1, 3, 7, 14, 30].map((days) => days * 86_400_000)),
  maxTargets: 2,
  anchorCount: 4,
  screeningPrompts: 8,
  diagnosticWindowSize: 40,
  minConfusionCount: 3,
  minConfusionOpportunities: 10,
  minConfusionChecks: 2,
  confusionRateDenominator: 5
} as const);

export function timestamp(value: string): number {
  if (typeof value !== 'string') return NaN;
  const result = Date.parse(value);
  return value.includes('T') && Number.isFinite(result) ? result : NaN;
}

/** Stable semantic comparison, independent of object property insertion order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

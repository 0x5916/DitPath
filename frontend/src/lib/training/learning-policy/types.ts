/** Prospective evidence only. Legacy attempts do not establish these fields. */
export interface GoalProfile {
  readonly id: string;
  readonly task: 'single-character';
  readonly charWpm: number;
  readonly audioCondition: 'clean';
  readonly responseSupport: 'open';
}
export interface TimeBounds {
  readonly source: 'monotonic-anchored' | 'wall-clock-bounded';
  readonly earliest: string;
  readonly latest: string;
}
export interface CheckPrompt {
  readonly id: string;
  readonly character: string;
  readonly role: 'target' | 'anchor';
}
export interface CheckPlan {
  readonly purpose: 'mixed-check';
  readonly id: string;
  readonly ownerKey: string;
  readonly policyVersion: string;
  readonly profile: GoalProfile;
  readonly startedAt: string;
  readonly targets: readonly string[];
  readonly introducedCharacters: readonly string[];
  readonly prompts: readonly CheckPrompt[];
  readonly freshOrder: boolean;
  readonly feedback: 'after-check';
  readonly reviewCycleIds?: Readonly<Record<string, string>>;
}
export interface Observation {
  readonly id: string;
  readonly ownerKey: string;
  readonly checkId: string;
  readonly promptId: string;
  readonly presentationId: string;
  readonly firstResponse: string | null;
  readonly finalResponse: string | null;
  readonly skipped: boolean;
  readonly replayCountBeforeResponse: number | null;
  readonly helpBeforeResponse: boolean | null;
  readonly audioValid: boolean | null;
  readonly interruptionInvalidated: boolean | null;
  readonly responseInterface: 'keyboard' | 'full-alphabet' | 'restricted';
  readonly firstPresentedAt: TimeBounds | null;
  readonly priorExposure: TimeBounds | null;
}
export interface Outcome {
  readonly eligible: boolean;
  readonly unassistedCorrect: boolean;
  readonly unassistedAttempt: boolean;
  readonly finalCorrect: boolean | null;
  readonly kind: 'unassisted' | 'supported' | 'incorrect' | 'skipped' | 'unmeasured' | 'unknown';
}
export interface Counts {
  readonly eligible: number;
  readonly unassistedCorrect: number;
  readonly finalCorrect: number;
}
export interface TargetTrial {
  readonly observationId: string;
  readonly promptId: string;
  readonly enteredText: string | null;
  readonly outcome: Outcome;
}
export interface TargetResult extends Counts {
  readonly trials: readonly TargetTrial[];
  readonly firstProbe: {
    readonly outcome: Outcome;
    readonly presentedAt: TimeBounds | null;
    readonly priorExposure: TimeBounds | null;
  } | null;
}
export interface EvaluatedCheck {
  readonly id: string;
  readonly ownerKey: string;
  readonly policyVersion: string;
  readonly profileKey: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly complete: boolean;
  readonly issues: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly targets: Readonly<Record<string, TargetResult>>;
  readonly whole: Counts;
  readonly reviewCycleIds: Readonly<Record<string, string>>;
}
export interface Attainment {
  readonly key: string;
  readonly ownerKey: string;
  readonly profileKey: string;
  readonly policyVersion: string;
  readonly character: string;
  readonly kind: 'proficiency' | 'retention';
  readonly awardedAt: string;
  readonly checkIds: readonly string[];
  readonly status: 'provisional' | 'verified' | 'unverified';
}
export interface EvidenceContext {
  readonly ownerKey: string;
  readonly profileKey: string;
  readonly character: string;
  readonly nowIso: string;
  readonly coverage: 'complete' | 'local-only' | 'partial';
}

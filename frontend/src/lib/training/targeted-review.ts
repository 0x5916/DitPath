import { LESSONS } from './sequence';
import { createPromptId } from './v2/ids';
import type { AttemptEvent, HistorySessionRecord, Prompt } from './v2/types';
import { sessionOccurredAt } from './v2/progress-summary';

export type ReviewPurpose = 'coaching' | 'return-screening';
export interface ReviewRequest {
  purpose: ReviewPurpose;
  targets: string[];
}
export interface ReviewPlan extends ReviewRequest {
  knownCharacters: string[];
  prompts: Prompt[];
}
const curriculum = LESSONS.join('').split('');
const DAY = 86_400_000;

/** URL intent is validated again against the owner's actual recorded characters. */
export function parseReviewRequest(value: string | null): ReviewRequest | null {
  if (value === 'return') return { purpose: 'return-screening', targets: [] };
  if (!value || value.length > 2) return null;
  const targets = [...new Set(value.toUpperCase().split(''))];
  return targets.length === 2 && targets.every((ch) => curriculum.includes(ch))
    ? { purpose: 'coaching', targets }
    : null;
}

/** Historical exposure is sufficient to select coaching; it never certifies ability. */
export function recordedCharacters(attempts: readonly AttemptEvent[]): string[] {
  const seen = new Set(attempts.flatMap((a) => a.targetCharacter.toUpperCase().split('')));
  return curriculum.filter((ch) => seen.has(ch));
}

export function reviewHref(characters: readonly string[]): string {
  return `/morse/learn/session?review=${encodeURIComponent(characters.join(''))}`;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new Error('Invalid random source');
    const j = Math.floor(draw * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Bounded, unscored practice. Feedback is immediate; these are never mixed assessments. */
export function buildReviewPlan(
  request: ReviewRequest,
  known: readonly string[],
  settings: { charWpm: number; effWpm: number; freqHz: number },
  random: () => number = Math.random,
  idGenerator: () => string = () => createPromptId()
): ReviewPlan {
  const knownCharacters = curriculum.filter((ch) => known.includes(ch));
  if (knownCharacters.length === 0) throw new Error('No recorded characters to review');
  if (
    ![settings.charWpm, settings.effWpm, settings.freqHz].every(Number.isFinite) ||
    settings.charWpm <= 0 ||
    settings.effWpm <= 0 ||
    settings.effWpm > settings.charWpm ||
    settings.freqHz <= 0
  )
    throw new Error('Invalid sound settings');
  let selected: string[];
  if (request.purpose === 'coaching') {
    if (
      request.targets.length !== 2 ||
      new Set(request.targets).size !== 2 ||
      !request.targets.every((ch) => knownCharacters.includes(ch))
    )
      throw new Error('Review targets must be two distinct recorded characters');
    const anchors = shuffled(
      knownCharacters.filter((ch) => !request.targets.includes(ch)),
      random
    );
    const pair = Array.from({ length: 6 }, (_, i) => request.targets[i % 2]);
    const support = anchors.length ? anchors : request.targets;
    selected = shuffled(
      [...pair, ...Array.from({ length: 6 }, (_, i) => support[i % support.length])],
      random
    );
  } else {
    const sample = shuffled(knownCharacters, random).slice(0, 8);
    selected = shuffled(
      Array.from({ length: 8 }, (_, i) => sample[i % sample.length]),
      random
    );
  }
  return {
    ...request,
    targets: [...request.targets],
    knownCharacters,
    prompts: selected.map((character, index) => ({
      id: idGenerator(),
      ordinal: index + 1,
      isScored: false,
      spec: { kind: 'recall', expectedText: character, characters: [character], ...settings }
    }))
  };
}

export function summarizeReview(attempts: readonly AttemptEvent[]) {
  const firstListen = attempts.filter((a) => a.isCorrect && a.replayCount === 0).length;
  const afterReplay = attempts.filter((a) => a.isCorrect && a.replayCount > 0).length;
  return {
    answered: attempts.length,
    firstListen,
    afterReplay,
    notCorrect: attempts.length - firstListen - afterReplay
  };
}

/** Absence invites a short re-entry round; it is not evidence of forgetting. */
export function returningLearner(
  history: readonly HistorySessionRecord[],
  known: readonly string[],
  nowIso: string,
  latestPilotAt?: string
): boolean {
  const now = Date.parse(nowIso);
  const times = history
    .filter((s) => (s.completedPromptCount ?? 0) > 0 || s.status === 'completed')
    .map((s) => Date.parse(sessionOccurredAt(s)));
  if (latestPilotAt) times.push(Date.parse(latestPilotAt));
  const valid = times.filter((t) => Number.isFinite(t) && t <= now);
  return known.length > 0 && valid.length > 0 && now - Math.max(...valid) >= 14 * DAY;
}

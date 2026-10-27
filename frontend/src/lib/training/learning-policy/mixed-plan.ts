import { LESSONS } from '../sequence';
import { createPromptId, createSessionId } from '../v2/ids';
import type { Prompt } from '../v2/types';
import { LEARNING_POLICY as P, timestamp } from './policy';
import type { CheckPlan, GoalProfile } from './types';

export interface MixedCheckInput {
  ownerKey: string;
  targets: readonly string[];
  knownCharacters: readonly string[];
  profile: GoalProfile;
  effWpm: number;
  freqHz: number;
  startedAt: string;
  checkId?: string;
  random?: () => number;
  promptId?: () => string;
  reviewCycleIds?: Readonly<Record<string, string>>;
}
export interface MixedCheckSession {
  plan: CheckPlan;
  prompts: Prompt[];
  effWpm: number;
  freqHz: number;
}
const curriculum = [...LESSONS.join('')];
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
      throw new RangeError('Invalid random source');
    const index = Math.floor(draw * (i + 1));
    [result[i], result[index]] = [result[index], result[i]];
  }
  return result;
}

/** A new, frozen mixed plan; no legacy score or progression is generated. */
export function buildMixedCheck(input: MixedCheckInput): MixedCheckSession {
  const known = curriculum.filter((character) => input.knownCharacters.includes(character));
  const targets = [...input.targets];
  if (
    !input.ownerKey.trim() ||
    !Number.isFinite(timestamp(input.startedAt)) ||
    targets.length < 1 ||
    targets.length > P.maxTargets ||
    new Set(targets).size !== targets.length ||
    known.length < 2 ||
    targets.some((character) => !known.includes(character))
  )
    throw new RangeError('Mixed targets must be distinct recorded characters');
  if (
    !input.profile.id ||
    input.profile.task !== 'single-character' ||
    input.profile.audioCondition !== 'clean' ||
    input.profile.responseSupport !== 'open' ||
    !Number.isInteger(input.profile.charWpm) ||
    input.profile.charWpm < 5 ||
    input.profile.charWpm > 50 ||
    !Number.isInteger(input.effWpm) ||
    input.effWpm < 5 ||
    input.effWpm > input.profile.charWpm ||
    !Number.isInteger(input.freqHz) ||
    input.freqHz < 300 ||
    input.freqHz > 2000
  )
    throw new RangeError('Invalid mixed-check listening conditions');
  const random = input.random ?? Math.random;
  const other = shuffle(
    known.filter((character) => !targets.includes(character)),
    random
  );
  const targetPrompts = targets.flatMap((character) =>
    Array.from({ length: P.opportunitiesPerTarget }, () => ({ character, role: 'target' as const }))
  );
  const anchors = other.length
    ? Array.from({ length: P.anchorCount }, (_, index) => ({
        character: other[index % other.length],
        role: 'anchor' as const
      }))
    : [];
  const createId = input.promptId ?? (() => createPromptId());
  const prompts = shuffle([...targetPrompts, ...anchors], random).map((prompt) => ({
    ...prompt,
    id: createId()
  }));
  if (
    prompts.some((prompt) => !prompt.id.trim()) ||
    new Set(prompts.map((prompt) => prompt.id)).size !== prompts.length
  )
    throw new RangeError('Mixed prompt identities must be unique');
  const plan: CheckPlan = {
    purpose: 'mixed-check',
    id: input.checkId ?? createSessionId(),
    ownerKey: input.ownerKey,
    policyVersion: P.version,
    profile: { ...input.profile },
    startedAt: input.startedAt,
    targets,
    introducedCharacters: known,
    prompts,
    freshOrder: true,
    feedback: 'after-check',
    reviewCycleIds: { ...input.reviewCycleIds }
  };
  if (!plan.id.trim()) throw new RangeError('A check identity is required');
  return {
    plan,
    effWpm: input.effWpm,
    freqHz: input.freqHz,
    prompts: prompts.map((prompt, index) => ({
      id: prompt.id,
      ordinal: index + 1,
      isScored: false,
      spec: {
        kind: 'recall',
        expectedText: prompt.character,
        characters: [prompt.character],
        charWpm: input.profile.charWpm,
        effWpm: input.effWpm,
        freqHz: input.freqHz
      }
    }))
  };
}

export function parseMixedTargets(value: string | null): string[] | null {
  if (!value || value.length > P.maxTargets) return null;
  const targets = [...value.toUpperCase()];
  return new Set(targets).size === targets.length &&
    targets.every((character) => curriculum.includes(character))
    ? targets
    : null;
}

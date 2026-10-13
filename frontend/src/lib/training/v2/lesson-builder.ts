/**
 * Deterministic guided lesson plan builder for DitPath V2.
 *
 * Constructs a structured, prompt-by-prompt session plan following the Koch method:
 * 1. Unscored introduction of the newest character(s)
 * 2. Unscored matching / familiarization prompts
 * 3. Scored single-character recall prompts
 * 4. Contrast prompts (distinguishing confusing pairs from active characters)
 * 5. Short 2-character group prompts
 * 6. Final exit check prompt
 *
 * Deterministic with injected random source; no reactive mutations.
 */

import { LESSONS, getLessonChars } from '../sequence';
import { createPromptId } from './ids';
import type { Prompt, PromptKind, PromptSpec } from './types';

export interface LessonPlanConfig {
  /** Unscored introduction prompts for newly introduced symbols. */
  introductionCount: number;
  /** Unscored matching / recognition prompts before scored recall. */
  unscoredMatchCount: number;
  /** Scored single-character recognition prompts. */
  scoredRecallCount: number;
  /** Contrast comparison prompts (e.g. M vs T). */
  contrastCount: number;
  /** Short 2-character groups. */
  shortGroupCount: number;
  /** Final exit check prompt. */
  exitCheckCount: number;
  charWpm: number;
  effWpm: number;
  freqHz: number;
}

export const DEFAULT_LESSON_PLAN_CONFIG: LessonPlanConfig = {
  introductionCount: 1,
  unscoredMatchCount: 2,
  scoredRecallCount: 6,
  contrastCount: 2,
  shortGroupCount: 2,
  exitCheckCount: 1,
  charWpm: 20,
  effWpm: 12,
  freqHz: 600
};

export interface BuildLessonPlanOptions extends Partial<LessonPlanConfig> {
  random?: () => number;
  idGenerator?: (prefix: string) => string;
}

/** Known common Morse acoustic confusion pairs (e.g. M [--] and T [-], S [...] and H [....]). */
const COMMON_CONFUSION_PAIRS: [string, string][] = [
  ['M', 'T'],
  ['E', 'T'],
  ['I', 'S'],
  ['S', 'H'],
  ['H', '5'],
  ['A', 'W'],
  ['U', 'V'],
  ['N', 'D'],
  ['D', 'B'],
  ['R', 'L'],
  ['K', 'C']
];

function pickRandom<T>(items: T[], random: () => number): T {
  const index = Math.floor(random() * items.length);
  return items[index];
}

/**
 * Finds a suitable contrast partner for targetChar from the active cumulative set.
 */
function findContrastPartner(
  targetChar: string,
  activeChars: string[],
  random: () => number
): string | null {
  for (const [a, b] of COMMON_CONFUSION_PAIRS) {
    if (a === targetChar && activeChars.includes(b)) return b;
    if (b === targetChar && activeChars.includes(a)) return a;
  }

  // Fallback: any other character in active set
  const others = activeChars.filter((c) => c !== targetChar);
  if (others.length === 0) return null;
  return pickRandom(others, random);
}

/**
 * Builds a deterministic guided lesson plan for a Koch curriculum step.
 */
export function buildLessonPlan(step: number, options: BuildLessonPlanOptions = {}): Prompt[] {
  const normalizedStep = Math.min(Math.max(1, Math.trunc(step)), LESSONS.length);
  const activeCharsString = getLessonChars(normalizedStep);
  const activeChars = activeCharsString.split('');

  // The symbol(s) introduced at this step
  const introducedString = LESSONS[normalizedStep - 1];
  const introducedChars = introducedString.split('');

  const random = options.random ?? Math.random;
  const idGen = options.idGenerator ?? (() => createPromptId({ random }));

  const config: LessonPlanConfig = {
    ...DEFAULT_LESSON_PLAN_CONFIG,
    ...options
  };

  const prompts: Prompt[] = [];
  let ordinal = 1;

  function addPrompt(
    kind: PromptKind,
    isScored: boolean,
    spec: Omit<PromptSpec, 'kind' | 'charWpm' | 'effWpm' | 'freqHz'>
  ): void {
    prompts.push({
      id: idGen('prm'),
      ordinal: ordinal++,
      isScored,
      spec: {
        kind,
        expectedText: spec.expectedText,
        characters: spec.characters,
        options: spec.options,
        charWpm: config.charWpm,
        effWpm: config.effWpm,
        freqHz: config.freqHz
      }
    });
  }

  // 1. Introduction phase (unscored)
  // For step 1 (K, M), introduce both; for subsequent steps introduce the new character
  for (const newChar of introducedChars) {
    for (let i = 0; i < config.introductionCount; i++) {
      addPrompt('introduction', false, {
        expectedText: newChar,
        characters: [newChar],
        options: [newChar]
      });
    }
  }

  // 2. Unscored match phase
  for (let i = 0; i < config.unscoredMatchCount; i++) {
    const target =
      i % 2 === 0 && introducedChars.length > 0
        ? pickRandom(introducedChars, random)
        : pickRandom(activeChars, random);

    // Provide 2-4 candidate options
    const otherOptions = activeChars.filter((c) => c !== target);
    const optionsCount = Math.min(activeChars.length, 4);
    const shuffledOthers = [...otherOptions].sort(() => random() - 0.5);
    const promptOptions = [target, ...shuffledOthers.slice(0, optionsCount - 1)].sort(
      () => random() - 0.5
    );

    addPrompt('unscored-match', false, {
      expectedText: target,
      characters: [target],
      options: promptOptions
    });
  }

  // 3. Scored recall phase
  // Heavy focus on the newest character plus review of known characters
  let lastChar = '';
  for (let i = 0; i < config.scoredRecallCount; i++) {
    // 50% probability on introduced character, 50% distributed across active set
    let target = '';
    let attempts = 0;
    while (attempts < 5) {
      if (random() < 0.5 && introducedChars.length > 0) {
        target = pickRandom(introducedChars, random);
      } else {
        target = pickRandom(activeChars, random);
      }
      attempts++;
      if (target !== lastChar || activeChars.length <= 1) break;
    }

    lastChar = target;
    addPrompt('recall', true, {
      expectedText: target,
      characters: [target]
    });
  }

  // 4. Contrast phase (if at least 2 active characters exist)
  if (activeChars.length >= 2 && config.contrastCount > 0) {
    const mainIntroduced = introducedChars[0];
    const partner = findContrastPartner(mainIntroduced, activeChars, random);

    if (partner) {
      for (let i = 0; i < config.contrastCount; i++) {
        const expected = i % 2 === 0 ? mainIntroduced : partner;
        addPrompt('contrast', true, {
          expectedText: expected,
          characters: [expected],
          options: [mainIntroduced, partner].sort()
        });
      }
    }
  }

  // 5. Short 2-character group recall phase
  if (config.shortGroupCount > 0 && activeChars.length >= 2) {
    for (let i = 0; i < config.shortGroupCount; i++) {
      const c1 = pickRandom(activeChars, random);
      const c2 = pickRandom(activeChars, random);
      const groupText = `${c1}${c2}`;

      addPrompt('short-group', true, {
        expectedText: groupText,
        characters: [c1, c2]
      });
    }
  }

  // 6. Exit check phase (scored test on the newest symbol)
  if (config.exitCheckCount > 0) {
    const exitChar = introducedChars[0];
    addPrompt('recall', true, {
      expectedText: exitChar,
      characters: [exitChar]
    });
  }

  return prompts;
}

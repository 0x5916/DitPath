/**
 * Compatibility facade for the original `$lib/morse` module.
 *
 * The implementation now lives in small plain-TypeScript modules under
 * `$lib/training`, free of Svelte/DOM/browser dependencies. Existing callers
 * keep importing from here; new code should prefer the training modules.
 */

export { LESSONS, MORSE, getLessonChars, getLessonCharacterSet } from './training/sequence';
export { calculateDuration, getFarnsworthWpmSet, buildAudioPlan } from './training/timing';
export type { AudioPlan, AudioPlanOptions, FarnsworthTimings, ToneEvent } from './training/timing';
export { createExercise, generateTimedLesson } from './training/exercise';
export type { Exercise, ExerciseOptions, RandomSource } from './training/exercise';

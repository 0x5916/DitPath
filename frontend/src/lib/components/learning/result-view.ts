import { LESSONS } from '../../training/sequence';
import type { SessionSummary } from '../../training/v2/types';

/** Present an existing progression decision without evaluating mastery again. */
export function resultView(summary: SessionSummary) {
  const validStep =
    Number.isInteger(summary.step) && summary.step >= 1 && summary.step <= LESSONS.length;
  const nextStep =
    validStep &&
    summary.step < LESSONS.length &&
    summary.unlockedNextStep &&
    summary.progressionReasonCode === 'unlocked_next_character'
      ? summary.step + 1
      : null;
  const courseComplete =
    validStep &&
    summary.step === LESSONS.length &&
    summary.progressionReasonCode === 'all_curriculum_completed';
  let reason:
    'next' | 'complete' | 'accuracy' | 'characters' | 'attempts' | 'sessions' | 'continue' =
    'continue';
  if (nextStep) reason = 'next';
  else if (courseComplete) reason = 'complete';
  else {
    switch (summary.progressionReasonCode) {
      case 'overall_accuracy_too_low':
        reason = 'accuracy';
        break;
      case 'weak_character_detected':
      case 'introduced_character_unstable':
        if (summary.weakCharacters.length) reason = 'characters';
        break;
      case 'insufficient_attempts':
        reason = 'attempts';
        break;
      case 'insufficient_sessions':
        reason = 'sessions';
        break;
    }
  }
  return {
    reason,
    action: nextStep ? 'next' : courseComplete ? 'finish' : 'repeat',
    nextStep,
    lessonCharacters: validStep ? LESSONS[summary.step - 1].split('').join(', ') : '',
    nextCharacters: nextStep ? LESSONS[nextStep - 1].split('').join(', ') : '',
    accuracyPercent: summary.scoredAttempts > 0 ? Math.round(summary.accuracy * 100) : null,
    latencySeconds:
      summary.scoredAttempts > 0 && summary.correctAttempts > 0 && summary.medianLatencyMs !== null
        ? (summary.medianLatencyMs / 1000).toFixed(1)
        : null
  } as const;
}

import * as m from '#lib/paraglide/messages.js';
import { getMasteryBlockers, type MasteryBlocker } from '#lib/training/v2/mastery.ts';
import { DEFAULT_MASTERY_POLICY, type CharacterMastery } from '#lib/training/v2/types.ts';

interface MasteryRequirement {
  id: MasteryBlocker;
  label: string;
  value: string;
  current?: number;
  target?: number;
}

const policy = DEFAULT_MASTERY_POLICY;

/** Translate the policy's blockers into the values shown beside a lesson character. */
export function masteryRequirements(mastery: CharacterMastery): MasteryRequirement[] {
  return getMasteryBlockers(mastery).map((id) => {
    switch (id) {
      case 'attempts':
        return {
          id,
          label: m.learn_unlock_attempts_label(),
          value: m.learn_unlock_count({
            count: mastery.totalAttempts,
            required: policy.minAttemptsForStability
          }),
          current: mastery.totalAttempts,
          target: policy.minAttemptsForStability
        };
      case 'sessions':
        return {
          id,
          label: m.learn_unlock_sessions_label(),
          value: m.learn_unlock_count({
            count: mastery.sessionCount,
            required: policy.minSessionsForStability
          }),
          current: mastery.sessionCount,
          target: policy.minSessionsForStability
        };
      case 'accuracy': {
        const required = Math.round(policy.targetAccuracy * 100);
        return {
          id,
          label: m.learn_unlock_accuracy_label(),
          value:
            mastery.totalAttempts === 0
              ? m.learn_unlock_accuracy_missing_value({ required })
              : m.learn_unlock_accuracy_value({
                  current: (mastery.rollingAccuracy * 100).toFixed(1),
                  required
                }),
          current: mastery.totalAttempts === 0 ? undefined : mastery.rollingAccuracy,
          target: policy.targetAccuracy
        };
      }
      case 'speed': {
        const required = (policy.maxAutomaticLatencyMs / 1000).toFixed(3);
        return {
          id,
          label: m.learn_unlock_speed_label(),
          value:
            mastery.medianLatencyMs === null
              ? m.learn_unlock_speed_missing_value({ required })
              : m.learn_unlock_speed_value({
                  current: (Math.ceil(mastery.medianLatencyMs) / 1000).toFixed(3),
                  required
                })
        };
      }
      case 'review':
        return { id, label: m.learn_unlock_review_due(), value: '' };
    }
  });
}

import type { Recommendation } from '../../training/learning-policy/recommendation';
import * as m from '#lib/paraglide/messages.js';
export function recommendationTitle(value: Recommendation): string {
  const characters = value.targets.join(', ');
  switch (value.reason) {
    case 'new-lesson':
      return m.learning_next_new({ step: value.lesson ?? 1, characters });
    case 'repair':
      return m.learning_next_repair({ characters });
    case 'due-check':
      return m.learning_next_due({ characters });
    case 'return-screening':
      return m.learning_next_return();
    case 'contextual-practice':
      return m.learning_next_context();
    case 'rest-or-adjust':
      return m.learning_next_adjust();
    case 'load-history':
      return m.learning_next_history();
    case 'recover-save':
    case 'recover-session':
      return m.learning_next_recover();
    default:
      return m.learning_next_calibrate();
  }
}

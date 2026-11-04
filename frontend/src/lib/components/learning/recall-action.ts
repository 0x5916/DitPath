import type { Recommendation } from '../../training/learning-policy/recommendation';
import { learningRecommendationHref } from '../../data/learning-snapshot';
import { recommendationTitle } from './recommendation-copy';
import * as m from '#lib/paraglide/messages.js';

export type RecallActionKind =
  'guided' | 'check' | 'review' | 'screening' | 'practice' | 'settings' | 'evidence';

export interface RecallAction {
  href: string;
  title: string;
  hint: string;
  kind: RecallActionKind;
}

function kindOf(href: string): RecallActionKind {
  if (href.startsWith('/morse/learn/session?check=')) return 'check';
  if (href.includes('review=return')) return 'screening';
  if (href.startsWith('/morse/learn/session?review=')) return 'review';
  if (href === '/morse/practice') return 'practice';
  if (href.startsWith('/settings')) return 'evidence';
  return 'guided';
}

/**
 * Presentation-only mapping for recall surfaces. A prospective `new-lesson`
 * recommendation opens Guided Lessons, which chooses the unlocked step. A
 * mixed check needs at least two known characters, so the same guard prevents
 * a linked check from becoming a dead end.
 */
export function recallAction(
  recommendation: Recommendation,
  knownCharacters: readonly string[]
): RecallAction {
  const href = learningRecommendationHref(recommendation, knownCharacters);
  if (
    recommendation.reason === 'new-lesson' ||
    (href.startsWith('/morse/learn/session?check=') && knownCharacters.length < 2)
  )
    return {
      href: '/morse/learn',
      title: m.learning_next_guided(),
      hint:
        recommendation.reason === 'new-lesson'
          ? m.review_next_guided_hint()
          : m.recall_need_second(),
      kind: 'guided'
    };
  const kind = kindOf(href);
  return {
    href,
    title: recommendationTitle(recommendation),
    hint: kind === 'evidence' ? m.recall_evidence_hint() : '',
    kind
  };
}

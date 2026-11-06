import { parseMixedTargets } from '#lib/training/learning-policy/mixed-plan.ts';
import { parseReviewRequest, type ReviewRequest } from '#lib/training/targeted-review.ts';
import { LESSONS } from '#lib/training/sequence.ts';

interface SessionIntent {
  step: number;
  review: string | null;
  reviewTargets: string | null;
  check: string | null;
  resume: string | null;
  reviewRequest: ReviewRequest | null;
  checkTargets: string[] | null;
  /** The URL names a review/check that cannot be resolved or combines both entry modes. */
  invalid: boolean;
  /** Stable identity for the current session configuration. */
  key: string;
  /** Entry URL without the continuation id, used when saving a checkpoint. */
  checkpointHref: string;
}

function readStep(value: string | null): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, LESSONS.length) : 1;
}

function checkpointHref(
  step: number,
  review: string | null,
  reviewTargets: string | null,
  check: string | null
): string {
  const params = new URLSearchParams({ step: String(step) });
  if (review !== null) params.set('review', review);
  if (reviewTargets !== null) params.set('targets', reviewTargets);
  if (check !== null) params.set('check', check);
  return `/morse/learn/session?${params}`;
}

interface SearchParams {
  get(name: string): string | null;
}

/** Validate immutable session entry parameters before any storage or audio work starts. */
export function readSessionIntent(params: SearchParams): SessionIntent {
  const review = params.get('review');
  const reviewTargets = params.get('targets');
  const check = params.get('check');
  const resume = params.get('resume');
  const reviewRequest = parseReviewRequest(review, reviewTargets);
  const checkTargets = parseMixedTargets(check);
  const invalid =
    (review !== null && !reviewRequest) ||
    (reviewTargets !== null && review !== 'return') ||
    (check !== null && !checkTargets) ||
    (review !== null && check !== null);
  const step = readStep(params.get('step'));

  return {
    step,
    review,
    reviewTargets,
    check,
    resume,
    reviewRequest,
    checkTargets,
    invalid,
    key: `${step}:${review ?? ''}:${reviewTargets ?? ''}:${check ?? ''}:${resume ?? ''}`,
    checkpointHref: checkpointHref(step, review, reviewTargets, check)
  };
}

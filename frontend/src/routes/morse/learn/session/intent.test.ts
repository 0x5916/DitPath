import { describe, expect, it } from 'vitest';
import { LESSONS } from '#lib/training/sequence.ts';
import { readSessionIntent } from './intent';

function intent(query: string) {
  return readSessionIntent(new URLSearchParams(query));
}

describe('guided session intent', () => {
  it('defaults to the first lesson without review or check flags', () => {
    expect(intent('')).toMatchObject({
      step: 1,
      review: null,
      reviewTargets: null,
      check: null,
      resume: null,
      reviewRequest: null,
      checkTargets: null,
      invalid: false,
      key: '1::::',
      checkpointHref: '/morse/learn/session?step=1'
    });
  });

  it('clamps lesson steps into the curriculum', () => {
    expect(intent('step=4').step).toBe(4);
    expect(intent('step=0').step).toBe(1);
    expect(intent('step=-2').step).toBe(1);
    expect(intent('step=not-a-number').step).toBe(1);
    expect(intent(`step=${LESSONS.length + 50}`).step).toBe(LESSONS.length);
  });

  it('builds a coaching review and its checkpoint URL', () => {
    const value = intent('step=3&review=KM');
    expect(value.reviewRequest).toEqual({ purpose: 'coaching', targets: ['K', 'M'] });
    expect(value.checkTargets).toBeNull();
    expect(value.invalid).toBe(false);
    expect(value.checkpointHref).toBe('/morse/learn/session?step=3&review=KM');
  });

  it('accepts a returning-learner screening with targets', () => {
    const value = intent('review=return&targets=KM');
    expect(value.reviewRequest).toEqual({ purpose: 'return-screening', targets: ['K', 'M'] });
    expect(value.invalid).toBe(false);
    expect(value.checkpointHref).toBe('/morse/learn/session?step=1&review=return&targets=KM');
  });

  it.each([
    ['review=K', 'incomplete coaching pair'],
    ['review=K!', 'unknown curriculum characters'],
    ['targets=KM', 'targets without a review mode'],
    ['review=KM&targets=KM', 'targets on a coaching review'],
    ['check=KK', 'duplicate check targets'],
    ['check=K!', 'unknown check target'],
    ['check=KM&review=KM', 'review and check together']
  ])('rejects %s (%s)', (query) => {
    expect(intent(query).invalid).toBe(true);
  });

  it('keeps the continuation id in the route identity but not the checkpoint entry', () => {
    const value = intent('step=2&review=return&targets=KM&resume=session-123');
    expect(value.resume).toBe('session-123');
    expect(value.key).toBe('2:return:KM::session-123');
    expect(value.checkpointHref).toBe('/morse/learn/session?step=2&review=return&targets=KM');
  });

  it('accepts a mixed check and preserves its entry URL', () => {
    const value = intent('check=KM');
    expect(value.checkTargets).toEqual(['K', 'M']);
    expect(value.invalid).toBe(false);
    expect(value.checkpointHref).toBe('/morse/learn/session?step=1&check=KM');
  });
});

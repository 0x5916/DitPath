import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../../training/learning-policy/recommendation';
import { recallAction } from './recall-action';

const recommendation = (
  reason: Recommendation['reason'],
  targets: string[] = [],
  lesson: number | null = null
): Recommendation => ({ reason, targets, lesson });

describe('recall action presentation', () => {
  it('sends a prospective new-lesson recommendation to the guided course path', () => {
    const action = recallAction(recommendation('new-lesson', ['R'], 4), ['K', 'M']);
    expect(action).toMatchObject({ href: '/morse/learn', kind: 'guided' });
    expect(action.title).not.toContain('Lesson 4');
    expect(action.hint).toBeTruthy();
  });

  it('preserves check, screening and evidence destinations', () => {
    expect(recallAction(recommendation('calibrate', ['K', 'M']), ['K', 'M'])).toMatchObject({
      href: '/morse/learn/session?check=KM',
      kind: 'check'
    });
    expect(recallAction(recommendation('return-screening', ['K']), ['K'])).toMatchObject({
      href: '/morse/learn/session?review=return&targets=K',
      kind: 'screening'
    });
    expect(recallAction(recommendation('load-history'), ['K'])).toMatchObject({
      href: '/settings#learning-evidence',
      kind: 'evidence',
      hint: expect.stringContaining('Settings')
    });
  });

  it('avoids a mixed-check dead end before two characters are known', () => {
    const action = recallAction(recommendation('calibrate', ['K']), ['K']);
    expect(action).toMatchObject({ href: '/morse/learn', kind: 'guided' });
    expect(action.hint).toBeTruthy();
  });

  it('completes a repair pair from known characters without adding a guided unlock', () => {
    expect(recallAction(recommendation('repair', ['K']), ['K', 'M'])).toMatchObject({
      href: '/morse/learn/session?review=KM',
      kind: 'review'
    });
  });
});

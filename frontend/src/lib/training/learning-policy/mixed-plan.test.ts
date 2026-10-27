import { describe, expect, it } from 'vitest';
import { buildMixedCheck, parseMixedTargets, type MixedCheckInput } from './mixed-plan';
const base: MixedCheckInput = {
  ownerKey: 'account:a',
  targets: ['K', 'M'],
  knownCharacters: ['K', 'M'],
  profile: {
    id: 'clean20',
    task: 'single-character',
    charWpm: 20,
    audioCondition: 'clean',
    responseSupport: 'open'
  },
  effWpm: 12,
  freqHz: 600,
  startedAt: '2026-10-27T00:00:00Z'
};
function build(overrides: Partial<MixedCheckInput> = {}) {
  let id = 0;
  return buildMixedCheck({ ...base, random: () => 0.3, promptId: () => `p${id++}`, ...overrides });
}
describe('prospective mixed plan', () => {
  it('uses20 initial K/M prompts and keeps legacy scoring disabled', () => {
    const s = build();
    expect(s.plan.prompts).toHaveLength(20);
    expect(s.prompts.every((p) => !p.isScored && p.spec.kind === 'recall')).toBe(true);
    expect(s.plan.feedback).toBe('after-check');
  });
  it('uses10 pertarget plus4 anchors with enoughdistinct sounds', () => {
    const s = build({ knownCharacters: ['K', 'M', 'R', 'S'] });
    expect(s.plan.prompts).toHaveLength(24);
    expect(s.plan.prompts.filter((p) => p.character === 'K')).toHaveLength(10);
    expect(s.plan.prompts.filter((p) => p.role === 'anchor')).toHaveLength(4);
    expect(new Set(s.plan.prompts.map((p) => p.character)).size).toBe(4);
  });
  it('one target has14 prompts withthree distinct anchors when available', () => {
    const s = build({ targets: ['K'], knownCharacters: ['K', 'M', 'R', 'S'] });
    expect(s.plan.prompts).toHaveLength(14);
    expect(new Set(s.plan.prompts.map((p) => p.character)).size).toBe(4);
  });
  it.each([
    { targets: ['K', 'K'] },
    { targets: ['R'] },
    { knownCharacters: ['K'] },
    { effWpm: 25 },
    { freqHz: 0 },
    { ownerKey: '' }
  ])('rejects invalid input %j', (o) => expect(() => build(o)).toThrow());
  it('rejects repeated prompt identities', () =>
    expect(() => build({ promptId: () => 'same' })).toThrow());
  it('does not mutate supplied scope', () => {
    const copy = JSON.stringify(base);
    build();
    expect(JSON.stringify(base)).toBe(copy);
  });
  it.each([
    ['km', ['K', 'M']],
    ['?', ['?']],
    ['KK', null],
    ['KMR', null],
    ['%', null],
    [null, null]
  ])('validates query %s', (value, expected) =>
    expect(parseMixedTargets(value as string | null)).toEqual(expected)
  );
});

import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { contextualPassage } from '../training/contextual-practice';
import { MORSE } from '../training/sequence';
import { learningHistory } from './learning-history';
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from './learning-evidence';
import { claimSession, validCheckpoint } from './session-checkpoints';
afterEach(() => vi.unstubAllGlobals());
const envelope = { policy_version: 'learning-policy-1.0', recorded_at: '2026-10-28T00:00:00Z' };
const plan: EvidenceRecord = {
  ...envelope,
  id: 'p',
  kind: 'plan',
  session_id: 's',
  purpose: 'mixed-check',
  started_at: envelope.recorded_at,
  targets: ['K'],
  char_wpm: 20,
  eff_wpm: 12,
  prompts: [{ id: 'q', character: 'K' }]
};
const answer: EvidenceRecord = {
  ...envelope,
  id: 'a',
  kind: 'observation',
  session_id: 's',
  prompt_id: 'q',
  presentation_id: 'tone',
  first_response: 'K',
  replay_count_before_response: 1,
  skipped: false,
  audio_valid: true,
  interruption_invalidated: false
};
it('generates deterministic supported words, callsigns and a complete simulated exchange', () => {
  for (const context of ['words', 'callsigns', 'contact'] as const) {
    const text = contextualPassage(context, () => 0.3);
    expect(text).toBe(contextualPassage(context, () => 0.3));
    expect([...text].every((c) => c === ' ' || c in MORSE)).toBe(true);
  }
  expect(contextualPassage('callsigns', () => 0)).toMatch(/^(?:K1AAA ){5}K1AAA$/);
  const exchange = contextualPassage('contact', () => 0.5);
  for (const token of ['CQ', ' DE ', 'RST 579', 'QTH', 'NAME', '73 SK'])
    expect(exchange).toContain(token);
  expect(() => contextualPassage('words', () => 1)).toThrow(RangeError);
});
it('never reveals active mixed-check answers or correctness through history', () => {
  const row = learningHistory([plan, answer])[0];
  expect(row.answered).toBe(1);
  expect(row.correct).toBeNull();
  expect(row.responses).toEqual([]);
});
it('retains incomplete outcomes, unresolved delivery and explicit claim corrections', () => {
  const records: EvidenceRecord[] = [
    plan,
    answer,
    {
      ...envelope,
      id: 'end',
      kind: 'terminal',
      session_id: 's',
      status: 'incomplete',
      ended_at: envelope.recorded_at
    },
    {
      ...envelope,
      id: 'claim',
      kind: 'milestone',
      check_ids: ['s'],
      character: 'K',
      milestone_kind: 'proficiency'
    },
    { ...envelope, id: 'fix', kind: 'milestone-correction', milestone_id: 'claim' }
  ];
  const row = learningHistory(records)[0];
  expect(row).toMatchObject({ status: 'incomplete', correct: 1, replayed: 1, invalid: 1 });
  expect(row.milestones[0].corrected).toBe(true);
  expect(learningHistory([{ ...plan, prompts: null }])).toEqual([]);
});
it('keeps local continuation metadata owner-isolated and outside imports/outboxes', async () => {
  const db = await openLearningEvidenceDb(new IDBFactory());
  try {
    const guest = createLearningEvidenceRepository(db, 'unclaimed'),
      account = createLearningEvidenceRepository(db, 'account:a');
    await guest.setCheckpoint('s', { id: 's', draft: 'K' });
    expect(await account.checkpoints()).toEqual([]);
    expect(await guest.pending()).toEqual([]);
    expect(await account.importUnclaimed(() => true)).toBe(0);
    expect(await account.getCheckpoint('s')).toBeNull();
    expect(await guest.getCheckpoint('s')).toEqual({ id: 's', draft: 'K' });
    await guest.setCheckpoint('s', null);
    expect(await guest.checkpoints()).toEqual([]);
  } finally {
    db.close();
  }
});
it('refuses a second live continuation and permits it after the first tab releases', async () => {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        name: string,
        _options: unknown,
        fn: (lock: object | null) => Promise<void>
      ) => {
        if (held.has(name)) return fn(null);
        held.add(name);
        try {
          await fn({});
        } finally {
          held.delete(name);
        }
      }
    }
  });
  const release = await claimSession('account:a', 's');
  await expect(claimSession('account:a', 's', true)).rejects.toThrow('another tab');
  await release();
  const again = await claimSession('account:a', 's', true);
  await again();
});
it('rejects malformed checkpoints and unsafe continuation destinations', () => {
  for (const value of [
    null,
    {},
    {
      version: 1,
      id: 's',
      draft: 'K',
      savedAt: envelope.recorded_at,
      kind: 'guided',
      href: 'javascript:alert(1)'
    }
  ])
    expect(validCheckpoint(value)).toBe(false);
});

import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LearningHistory from './LearningHistory.svelte';
import type { LearningHistoryEntry } from '../../data/learning-history';

const entry: LearningHistoryEntry = {
  id: 's',
  purpose: 'screening',
  status: 'completed',
  recordedStatus: 'completed',
  evidenceStatus: 'complete',
  at: '2026-10-01T00:00:00.000Z',
  targets: ['K'],
  charWpm: 20,
  effWpm: 12,
  planned: 8,
  answered: 8,
  correct: 8,
  replayed: 0,
  skipped: 0,
  invalid: 0,
  responses: [],
  milestones: []
};

describe('learning history presentation', () => {
  it('labels a complete terminal as completed without an evidence warning', () => {
    const { body } = render(LearningHistory, { props: { entries: [entry] } });
    expect(body).toContain('· Completed');
    expect(body).not.toContain('Incomplete evidence');
    expect(body).not.toContain('Recorded as completed');
  });

  it('distinguishes an older completed terminal whose evidence is incomplete', () => {
    const { body } = render(LearningHistory, {
      props: {
        entries: [
          {
            ...entry,
            status: 'incomplete',
            evidenceStatus: 'missing'
          }
        ]
      }
    });
    expect(body).toContain('Incomplete evidence');
    expect(body).toContain('Recorded as completed');
    expect(body).not.toContain('· Completed');
  });

  it('labels permanently rejected evidence instead of in-progress work', () => {
    const { body } = render(LearningHistory, {
      props: {
        entries: [
          {
            ...entry,
            status: 'incomplete',
            evidenceStatus: 'rejected'
          }
        ]
      }
    });
    expect(body).toContain('Evidence rejected');
    expect(body).not.toContain('· In progress');
    expect(body).toContain('Recorded as completed');
  });
});

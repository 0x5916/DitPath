import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { CopyAttempt } from '../practice/copy-attempt';
import { createCopyCheckpointStore } from '../practice/copy-checkpoint.svelte';
import { createLearningEvidenceRepository, openLearningEvidenceDb } from './learning-evidence';
import {
  claimSession,
  discardCheckpoint,
  listCheckpoints,
  loadCheckpoint,
  removeCheckpoint,
  saveCheckpoint,
  validCheckpoint,
  type CopyCheckpoint,
  type GuidedCheckpoint
} from './session-checkpoints';

const owner = 'unclaimed';

function copyAttempt(id = 'attempt-1'): CopyAttempt {
  return {
    id,
    exercise: { lesson: 1, text: 'KM' },
    settings: { charWpm: 20, effWpm: 12, freq: 600, volume: 1, startDelay: 0.5 },
    session: { status: 'awaiting-check', attempt: 2, recordedAttempt: null },
    duration: 1,
    startedAt: '2026-11-01T00:00:00.000Z',
    review: null
  };
}

function copyCheckpoint(draft = 'KM', savedAt = '2026-11-01T00:00:01.000Z'): CopyCheckpoint {
  return {
    version: 1,
    kind: 'copy',
    id: 'copy',
    href: '/morse/practice',
    savedAt,
    draft,
    attempt: copyAttempt()
  };
}

function guidedCheckpoint(id: string, savedAt: string): GuidedCheckpoint {
  return {
    version: 1,
    kind: 'guided',
    id,
    href: `/morse/learn/session?step=1&resume=${id}`,
    savedAt,
    draft: '',
    state: {
      sessionId: id,
      prompts: [{ id: 'prompt-1' }],
      currentPromptIndex: 0,
      currentPrompt: { id: 'prompt-1' },
      attempts: [],
      phase: 'ready'
    },
    record: { id, status: 'in-progress' },
    review: null,
    mixed: null,
    first: null
  } as unknown as GuidedCheckpoint;
}

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
  vi.stubGlobal('window', { indexedDB: factory });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session checkpoint persistence', () => {
  it('round-trips a copy checkpoint and removes it', async () => {
    const checkpoint = copyCheckpoint();
    await saveCheckpoint(owner, checkpoint);

    expect(await loadCheckpoint(owner, 'copy')).toEqual(checkpoint);
    expect(await loadCheckpoint('account:other', 'copy')).toBeNull();

    await removeCheckpoint(owner, 'copy');
    expect(await loadCheckpoint(owner, 'copy')).toBeNull();
  });

  it('isolates owners and sorts valid checkpoints by saved time', async () => {
    await saveCheckpoint(owner, copyCheckpoint('guest'));
    await saveCheckpoint('account:a', guidedCheckpoint('older', '2026-11-01T00:00:01.000Z'));
    await saveCheckpoint('account:a', guidedCheckpoint('newer', '2026-11-01T00:00:02.000Z'));

    expect((await listCheckpoints(owner)).map((item) => item.id)).toEqual(['copy']);
    expect((await listCheckpoints('account:a')).map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('ignores corrupt stored values and refuses to persist invalid ones', async () => {
    const db = await openLearningEvidenceDb();
    try {
      await createLearningEvidenceRepository(db, owner).setCheckpoint('corrupt', {
        version: 99,
        kind: 'copy'
      });
    } finally {
      db.close();
    }

    expect(await loadCheckpoint(owner, 'corrupt')).toBeNull();
    expect(await listCheckpoints(owner)).toEqual([]);
    await expect(saveCheckpoint(owner, {} as CopyCheckpoint)).rejects.toThrow(
      'Invalid session checkpoint'
    );
  });

  it('discards a copy checkpoint through the session lease', async () => {
    const locks = new Set<string>();
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          name: string,
          _options: unknown,
          callback: (lock: object | null) => Promise<void>
        ) => {
          if (locks.has(name)) return callback(null);
          locks.add(name);
          try {
            await callback({});
          } finally {
            locks.delete(name);
          }
        }
      }
    });
    const checkpoint = copyCheckpoint();
    await saveCheckpoint(owner, checkpoint);

    await discardCheckpoint(owner, checkpoint);

    expect(await loadCheckpoint(owner, 'copy')).toBeNull();
  });

  it('fails a continuation when session locking is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const release = await claimSession(owner, 'copy');
    await release();
    await expect(claimSession(owner, 'copy', true)).rejects.toThrow('Session locking unavailable');
  });

  it('persists and clears through the copy store using the real repository', async () => {
    const store = createCopyCheckpointStore({
      owner: () => owner,
      claim: async () => async () => {}
    });
    await store.load();
    store.checkpoint(copyAttempt(), 'KM');
    await store.whenIdle();

    expect(await loadCheckpoint(owner, 'copy')).toMatchObject({ draft: 'KM' });

    await store.clearForAttempt('attempt-1');
    expect(await loadCheckpoint(owner, 'copy')).toBeNull();
    await store.dispose();
  });
});

describe('checkpoint validation', () => {
  it('accepts a valid copy checkpoint', () => {
    expect(validCheckpoint(copyCheckpoint())).toBe(true);
  });

  it.each([
    ['missing attempt id', { attempt: { ...copyAttempt(), id: undefined } }],
    ['missing exercise text', { attempt: { ...copyAttempt(), exercise: { lesson: 1 } } }],
    [
      'invalid exercise lesson',
      { attempt: { ...copyAttempt(), exercise: { lesson: NaN, text: 'KM' } } }
    ],
    ['missing settings', { attempt: { ...copyAttempt(), settings: undefined } }],
    ['incomplete settings', { attempt: { ...copyAttempt(), settings: { charWpm: 20 } } }],
    ['missing session', { attempt: { ...copyAttempt(), session: undefined } }],
    [
      'invalid session status',
      {
        attempt: {
          ...copyAttempt(),
          session: { status: 'unknown', attempt: 1, recordedAttempt: null }
        }
      }
    ],
    ['wrong destination', { href: '/morse/learn' }],
    ['invalid saved time', { savedAt: 'not-a-date' }],
    [
      'oversized exercise',
      { attempt: { ...copyAttempt(), exercise: { lesson: 1, text: 'K'.repeat(10_001) } } }
    ]
  ])('rejects a copy checkpoint with %s', (_label, overrides) => {
    expect(validCheckpoint({ ...copyCheckpoint(), ...overrides })).toBe(false);
  });

  it('accepts a valid guided checkpoint and rejects a stale prompt index', () => {
    const checkpoint = guidedCheckpoint('session-1', '2026-11-01T00:00:01.000Z');
    expect(validCheckpoint(checkpoint)).toBe(true);
    expect(
      validCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, currentPromptIndex: 1 }
      })
    ).toBe(false);
  });

  it('rejects corrupt guided entries without throwing', () => {
    const checkpoint = guidedCheckpoint('session-1', '2026-11-01T00:00:01.000Z');
    expect(() =>
      validCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, prompts: [null] }
      })
    ).not.toThrow();
    expect(
      validCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, prompts: [null] }
      })
    ).toBe(false);
    expect(
      validCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, attempts: [null] }
      })
    ).toBe(false);
    expect(
      validCheckpoint({
        ...checkpoint,
        state: { ...checkpoint.state, attempts: [{ sessionId: 'session-1' }] }
      })
    ).toBe(false);
  });
});

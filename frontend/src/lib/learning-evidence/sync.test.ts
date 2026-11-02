import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  captureProcessId,
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from '../data/learning-evidence';
import { reqToPromise } from '../data/training-db';
import { activeLearningProfile, projectLearningSnapshot } from '../data/learning-snapshot';
import { synchronizeLearningEvidence } from './sync';
const dbs: IDBDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
const record: EvidenceRecord = {
  id: 'open',
  kind: 'exposure-open',
  policy_version: 'learning-policy-1.0',
  recorded_at: '2026-10-27T00:00:00.000Z',
  session_id: null,
  characters: ['M', 'K'],
  source: 'reference',
  presentation_id: 'p',
  started_at: null
};
async function fixture() {
  const db = await openLearningEvidenceDb(new IDBFactory());
  dbs.push(db);
  return { db, repo: createLearningEvidenceRepository(db, 'account:a') };
}
describe('prospective evidence repository and synchronization', () => {
  it('preserves owner isolation and immutable pending records', async () => {
    const { db, repo } = await fixture();
    await repo.append([record]);
    await repo.append([record]);
    expect(await repo.pending()).toHaveLength(1);
    await expect(repo.append([{ ...record, characters: ['R'] }])).rejects.toThrow('Immutable');
    expect(await createLearningEvidenceRepository(db, 'account:b').all()).toEqual([]);
    await expect(repo.append([{ ...record, kind: 'milestone' }])).rejects.toThrow('Invalid');
  });
  it('accepts semantically normalized server retries and a separate checkpoint', async () => {
    const { db, repo } = await fixture();
    await repo.append([record]);
    const paths: string[] = [];
    await synchronizeLearningEvidence({
      repository: repo,
      isCurrent: () => true,
      request: async (path) => {
        paths.push(path);
        return path.endsWith('/batch')
          ? Response.json({ acknowledged_ids: ['open'], rejected_records: [] })
          : Response.json({
              changes: [
                {
                  revision: '1',
                  kind: 'exposure-open',
                  record: { ...record, characters: ['K', 'M'], recorded_at: '2026-10-27T00:00:00Z' }
                }
              ],
              next_cursor: 'c1',
              has_more: false
            });
      }
    });
    expect(await repo.pending()).toEqual([]);
    expect(await repo.all()).toHaveLength(1);
    expect(await repo.getCursor()).toBe('c1');
    const row = await reqToPromise(
      db.transaction('records').objectStore('records').get(['account:a', 'open'])
    );
    expect(row.processId).toBe(captureProcessId());
    expect(paths.every((p) => p.includes('/learning-evidence/'))).toBe(true);
  });
  it('retains work on unsupported API and never falls back to old event endpoints', async () => {
    const { repo } = await fixture();
    await repo.append([record]);
    const paths: string[] = [];
    await expect(
      synchronizeLearningEvidence({
        repository: repo,
        isCurrent: () => true,
        request: async (path) => {
          paths.push(path);
          return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
        }
      })
    ).rejects.toMatchObject({ unavailable: true });
    expect(await repo.pending()).toHaveLength(1);
    expect(paths).toHaveLength(1);
  });
  it('ignores a late acknowledgement after owner changes', async () => {
    const { repo } = await fixture();
    await repo.append([record]);
    let active = true;
    await expect(
      synchronizeLearningEvidence({
        repository: repo,
        isCurrent: () => active,
        request: async () => {
          active = false;
          return Response.json({ acknowledged_ids: ['open'], rejected_records: [] });
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await repo.pending()).toHaveLength(1);
  });
  it('keeps page data and cursor atomic on a changed immutable record', async () => {
    const { repo } = await fixture();
    await repo.append([record]);
    await expect(
      repo.applyPage(
        [{ revision: '1', kind: 'exposure-open', record: { ...record, source: 'group' } }],
        'bad'
      )
    ).rejects.toThrow('conflict');
    expect(await repo.getCursor()).toBeNull();
    expect((await repo.all())[0].source).toBe('reference');
  });
  it('resets a retired checkpoint while preserving pending and downloaded history', async () => {
    const { repo } = await fixture();
    await repo.applyPage([], 'old');
    let calls = 0;
    await synchronizeLearningEvidence({
      repository: repo,
      isCurrent: () => true,
      request: async () =>
        ++calls === 1
          ? Response.json({ code: 'LEARNING_EVIDENCE_CURSOR_RESET_REQUIRED' }, { status: 410 })
          : Response.json({ changes: [], next_cursor: 'new', has_more: false })
    });
    expect(await repo.getCursor()).toBe('new');
  });
  it('terminalizes a permanent rejection and its dependency chain without retrying', async () => {
    const { repo } = await fixture();
    const plan: EvidenceRecord = {
      id: 'plan',
      kind: 'plan',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-27T00:00:00.000Z',
      session_id: 's1'
    };
    const observation: EvidenceRecord = {
      id: 'observation',
      kind: 'observation',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-27T00:00:01.000Z',
      session_id: 's1',
      presentation_id: 'p1'
    };
    const terminal: EvidenceRecord = {
      id: 'terminal',
      kind: 'terminal',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-27T00:00:02.000Z',
      session_id: 's1',
      observation_ids: ['observation']
    };
    await repo.append([plan, observation, terminal]);
    let batches = 0;
    await synchronizeLearningEvidence({
      repository: repo,
      isCurrent: () => true,
      request: async (path) => {
        if (path.endsWith('/batch')) {
          batches++;
          return Response.json({
            acknowledged_ids: [],
            rejected_records: [
              {
                id: 'plan',
                error_code: 'ID_CONFLICT',
                message: 'conflict',
                retryable: false
              },
              {
                id: 'observation',
                error_code: 'MISSING_EVIDENCE_DEPENDENCY',
                message: 'missing',
                retryable: true
              },
              {
                id: 'terminal',
                error_code: 'MISSING_EVIDENCE_DEPENDENCY',
                message: 'missing',
                retryable: true
              }
            ]
          });
        }
        return Response.json({ changes: [], next_cursor: 'c1', has_more: false });
      }
    });
    expect(batches).toBe(1);
    expect(await repo.pending()).toEqual([]);
    expect(await repo.getSyncStatus()).toEqual({
      pending: 0,
      rejected: 1,
      blocked: 2,
      error: null
    });
    expect((await repo.all()).map((record) => record.id)).toEqual([
      'plan',
      'observation',
      'terminal'
    ]);
    // A late retryable response cannot revive terminal work.
    await repo.reject('observation', 'MISSING_EVIDENCE_DEPENDENCY', false);
    expect(await repo.getSyncStatus()).toMatchObject({ pending: 0, blocked: 2 });
    expect(await repo.rejectedIds()).toEqual(['plan', 'observation', 'terminal']);
  });

  it('terminalizes session-scoped exposure guards and closures when their plan is rejected', async () => {
    const { db, repo } = await fixture();
    const plan: EvidenceRecord = {
      id: 'plan',
      kind: 'plan',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-27T00:00:00.000Z',
      session_id: 's1',
      purpose: 'screening'
    };
    const records: EvidenceRecord[] = [plan];
    for (let index = 0; index < 8; index++) {
      const open = `open-${index}`;
      records.push({
        id: open,
        kind: 'exposure-open',
        policy_version: 'learning-policy-1.0',
        recorded_at: `2026-10-27T00:00:0${index + 1}.000Z`,
        session_id: 's1',
        presentation_id: `tone-${index}`,
        characters: ['K'],
        source: 'screening',
        started_at: null
      });
      records.push({
        id: `close-${index}`,
        kind: 'exposure-close',
        policy_version: 'learning-policy-1.0',
        recorded_at: `2026-10-27T00:00:1${index}.000Z`,
        open_id: open,
        end_reason: 'completed',
        last_exposure: { K: null }
      });
    }
    await repo.append(records);
    let batches = 0;
    await synchronizeLearningEvidence({
      repository: repo,
      isCurrent: () => true,
      request: async (path) => {
        if (path.endsWith('/batch')) {
          batches++;
          return Response.json({
            acknowledged_ids: [],
            rejected_records: [
              {
                id: 'plan',
                error_code: 'INVALID_RECORD',
                message: 'invalid plan',
                retryable: false
              },
              ...records.slice(1).map((record) => ({
                id: record.id,
                error_code: 'MISSING_EVIDENCE_DEPENDENCY',
                message: 'missing plan',
                retryable: true
              }))
            ]
          });
        }
        return Response.json({ changes: [], next_cursor: 'c1', has_more: false });
      }
    });
    expect(batches).toBe(1);
    expect(await repo.pending()).toEqual([]);
    expect(await repo.getSyncStatus()).toEqual({
      pending: 0,
      rejected: 1,
      blocked: 16,
      error: null
    });
    // Reloading the same ledger cannot revive the terminal dependency chain.
    const reloaded = createLearningEvidenceRepository(db, 'account:a');
    expect(await reloaded.pending()).toEqual([]);
    expect(await reloaded.getSyncStatus()).toMatchObject({
      pending: 0,
      rejected: 1,
      blocked: 16
    });
    const independent: EvidenceRecord = { ...record, id: 'independent-after-rejection' };
    await reloaded.append([independent]);
    await synchronizeLearningEvidence({
      repository: reloaded,
      isCurrent: () => true,
      request: async (path) =>
        path.endsWith('/batch')
          ? Response.json({
              acknowledged_ids: ['independent-after-rejection'],
              rejected_records: []
            })
          : Response.json({ changes: [], next_cursor: 'c2', has_more: false })
    });
    expect(await reloaded.pending()).toEqual([]);
    expect(await reloaded.getSyncStatus()).toEqual({
      pending: 0,
      rejected: 1,
      blocked: 16,
      error: null
    });
  });

  it('keeps independent valid evidence synchronizing after a permanent rejection', async () => {
    const { repo } = await fixture();
    const plan: EvidenceRecord = {
      id: 'plan',
      kind: 'plan',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-27T00:00:00.000Z',
      session_id: 's1'
    };
    const independent: EvidenceRecord = {
      ...record,
      id: 'independent'
    };
    await repo.append([plan, independent]);
    await synchronizeLearningEvidence({
      repository: repo,
      isCurrent: () => true,
      request: async (path) =>
        path.endsWith('/batch')
          ? Response.json({
              acknowledged_ids: ['independent'],
              rejected_records: [
                { id: 'plan', error_code: 'INVALID_RECORD', message: 'bad', retryable: false }
              ]
            })
          : Response.json({ changes: [], next_cursor: 'c2', has_more: false })
    });
    expect(await repo.pending()).toEqual([]);
    expect(await repo.getSyncStatus()).toEqual({
      pending: 0,
      rejected: 1,
      blocked: 0,
      error: null
    });
    expect((await repo.all()).map((record) => record.id)).toEqual(['plan', 'independent']);
  });

  it('retains a genuinely retryable failure instead of suppressing it', async () => {
    const { repo } = await fixture();
    await repo.append([record]);
    await expect(
      synchronizeLearningEvidence({
        repository: repo,
        isCurrent: () => true,
        request: async (path) =>
          path.endsWith('/batch')
            ? Response.json({
                acknowledged_ids: [],
                rejected_records: [
                  {
                    id: 'open',
                    error_code: 'MISSING_EVIDENCE_DEPENDENCY',
                    message: 'retry',
                    retryable: true
                  }
                ]
              })
            : Response.json({ changes: [], next_cursor: 'c3', has_more: false })
      })
    ).rejects.toMatchObject({ code: 'MISSING_EVIDENCE_DEPENDENCY' });
    expect(await repo.pending()).toHaveLength(1);
    expect(await repo.getSyncStatus()).toEqual({
      pending: 1,
      rejected: 0,
      blocked: 0,
      error: 'MISSING_EVIDENCE_DEPENDENCY'
    });
  });

  it('blocks dependents appended after the dependency was rejected', async () => {
    const { repo } = await fixture();
    await repo.append([record]);
    await repo.reject('open', 'INVALID_RECORD', true);
    const close: EvidenceRecord = {
      id: 'close',
      kind: 'exposure-close',
      policy_version: 'learning-policy-1.0',
      recorded_at: '2026-10-27T00:00:03.000Z',
      open_id: 'open',
      end_reason: 'completed',
      last_exposure: {}
    };
    await repo.append([close]);
    expect(await repo.pending()).toEqual([]);
    expect(await repo.getSyncStatus()).toEqual({
      pending: 0,
      rejected: 1,
      blocked: 1,
      error: null
    });
  });

  it('rejects a non-advancing continuation', async () => {
    const { repo } = await fixture();
    await expect(
      synchronizeLearningEvidence({
        repository: repo,
        isCurrent: () => true,
        request: async () => Response.json({ changes: [], next_cursor: 'empty', has_more: true })
      })
    ).rejects.toThrow('STALLED');
  });

  it('reconciles a permanently rejected terminal as rejected evidence after reload', async () => {
    const { db, repo } = await fixture(),
      profile = activeLearningProfile(20),
      nowIso = '2026-10-28T00:00:00.000Z';
    const session = (id: string) => {
      const presentation = `tone_${id}`,
        prompt = `prompt_${id}`,
        at = `2026-10-27T00:00:0${id === 'a' ? 1 : 2}.000Z`,
        plan: EvidenceRecord = {
          id: `plan_${id}`,
          kind: 'plan',
          policy_version: 'learning-policy-1.0',
          recorded_at: at,
          session_id: id,
          purpose: 'screening',
          profile: {
            id: profile.id,
            task: profile.task,
            char_wpm: 20,
            audio_condition: 'clean',
            response_support: 'open'
          },
          started_at: at,
          targets: ['K'],
          prompts: [{ id: prompt, character: 'K' }],
          feedback: 'immediate',
          char_wpm: 20,
          eff_wpm: 12
        },
        observation: EvidenceRecord = {
          id: `answer_${id}`,
          kind: 'observation',
          policy_version: 'learning-policy-1.0',
          recorded_at: at,
          session_id: id,
          prompt_id: prompt,
          presentation_id: presentation,
          first_response: 'K',
          final_response: 'K',
          skipped: false,
          replay_count_before_response: 0,
          help_before_response: false,
          audio_valid: true,
          interruption_invalidated: false,
          response_interface: 'keyboard',
          first_presented_at: {
            earliest: at,
            latest: at,
            source: 'wall-clock-bounded'
          }
        },
        open: EvidenceRecord = {
          id: `open_${id}`,
          kind: 'exposure-open',
          policy_version: 'learning-policy-1.0',
          recorded_at: at,
          session_id: id,
          presentation_id: presentation,
          characters: ['K'],
          source: 'screening',
          started_at: { earliest: at, latest: at, source: 'wall-clock-bounded' }
        },
        close: EvidenceRecord = {
          id: `close_${id}`,
          kind: 'exposure-close',
          policy_version: 'learning-policy-1.0',
          recorded_at: at,
          open_id: open.id,
          end_reason: 'completed',
          last_exposure: { K: { earliest: at, latest: at, source: 'wall-clock-bounded' } }
        },
        terminal: EvidenceRecord = {
          id: `end_${id}`,
          kind: 'terminal',
          policy_version: 'learning-policy-1.0',
          recorded_at: at,
          session_id: id,
          status: 'completed',
          ended_at: at,
          observation_ids: [observation.id]
        };
      return { plan, observation, open, close, terminal };
    };
    const a = session('a'),
      b = session('b');
    await repo.append([
      a.plan,
      a.open,
      a.close,
      a.observation,
      a.terminal,
      b.plan,
      b.open,
      b.close,
      b.observation,
      b.terminal
    ]);
    await synchronizeLearningEvidence({
      repository: repo,
      isCurrent: () => true,
      request: async (path) =>
        path.endsWith('/batch')
          ? Response.json({
              acknowledged_ids: [
                a.plan.id,
                a.open.id,
                a.close.id,
                a.observation.id,
                b.plan.id,
                b.open.id,
                b.close.id,
                b.observation.id,
                b.terminal.id
              ],
              rejected_records: [
                {
                  id: a.terminal.id,
                  error_code: 'ID_CONFLICT',
                  message: 'conflict',
                  retryable: false
                }
              ]
            })
          : Response.json({ changes: [], next_cursor: 'c1', has_more: false })
    });
    const reloaded = createLearningEvidenceRepository(db, 'account:a');
    expect(await reloaded.rejectedIds()).toEqual([a.terminal.id]);
    const snapshot = projectLearningSnapshot(await reloaded.all(), {
      ownerKey: 'account:a',
      profile,
      knownCharacters: ['K'],
      nowIso,
      excludedRecordIds: await reloaded.rejectedIds()
    });
    expect(snapshot.history.find((entry) => entry.id === 'a')).toMatchObject({
      status: 'incomplete',
      recordedStatus: 'completed',
      evidenceStatus: 'rejected'
    });
    expect(snapshot.history.find((entry) => entry.id === 'b')).toMatchObject({
      status: 'completed',
      evidenceStatus: 'complete'
    });
  });
});

it('prevents a stale tab from rolling back a newer checkpoint or cursor reset', async () => {
  const db = await openLearningEvidenceDb(new IDBFactory());
  dbs.push(db);
  const first = createLearningEvidenceRepository(db, 'account:a'),
    second = createLearningEvidenceRepository(db, 'account:a');
  await first.applyPage([], 'new', null);
  await expect(
    second.applyPage([{ revision: '1', kind: record.kind, record }], 'old', null)
  ).rejects.toThrow('checkpoint changed');
  expect(await first.getCursor()).toBe('new');
  expect(await first.all()).toEqual([]);
  await expect(second.resetCursor('old')).rejects.toThrow('checkpoint changed');
  expect(await first.getCursor()).toBe('new');
});

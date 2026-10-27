import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  captureProcessId,
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from '../data/learning-evidence';
import { reqToPromise } from '../data/training-db';
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

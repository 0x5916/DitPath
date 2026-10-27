import { afterEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from './learning-evidence';
const dbs: IDBDatabase[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
const record = (id: string): EvidenceRecord => ({
  id,
  kind: 'exposure-open',
  policy_version: 'learning-policy-1.0',
  recorded_at: '2026-10-28T00:00:00Z',
  session_id: null,
  characters: ['K'],
  source: 'reference',
  presentation_id: `p_${id}`,
  started_at: null
});
async function fixture() {
  const db = await openLearningEvidenceDb(new IDBFactory());
  dbs.push(db);
  const guest = createLearningEvidenceRepository(db, 'unclaimed');
  const a = createLearningEvidenceRepository(db, 'account:a');
  const b = createLearningEvidenceRepository(db, 'account:b');
  await guest.append([record('one'), record('two')]);
  return { db, guest, a, b };
}
it('preserves guest evidence and uncertainty, queues once, and imports later additions', async () => {
  const { guest, a, b } = await fixture();
  expect(await a.getImportStatus()).toEqual({ count: 2, blocked: false });
  expect(await a.importUnclaimed(() => true)).toBe(2);
  expect(await a.all()).toEqual(await guest.all());
  expect(await guest.pending()).toEqual([]);
  expect(await a.pending()).toHaveLength(2);
  expect(await a.importUnclaimed(() => true)).toBe(0);
  await guest.append([record('three')]);
  expect(await a.getImportStatus()).toEqual({ count: 1, blocked: false });
  expect(await a.importUnclaimed(() => true)).toBe(1);
  expect(await a.pending()).toHaveLength(3);
  expect(await b.getImportStatus()).toEqual({ count: 0, blocked: true });
  await expect(b.importUnclaimed(() => true)).rejects.toThrow('assigned');
  expect(await b.all()).toEqual([]);
});
it('serializes competing accounts into one durable destination', async () => {
  const { a, b } = await fixture();
  const results = await Promise.allSettled([
    a.importUnclaimed(() => true),
    b.importUnclaimed(() => true)
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await a.all()).length + (await b.all()).length).toBe(2);
  expect((await a.getImportStatus()).blocked !== (await b.getImportStatus()).blocked).toBe(true);
});
it('rolls back earlier copies, outbox entries and assignments on an ID conflict', async () => {
  const { a, b } = await fixture();
  await a.append([{ ...record('two'), characters: ['M'] }]);
  await expect(a.importUnclaimed(() => true)).rejects.toThrow('conflict');
  expect((await a.all()).map((r) => r.id)).toEqual(['two']);
  expect((await a.pending()).map((r) => r.id)).toEqual(['two']);
  expect(await b.getImportStatus()).toEqual({ count: 2, blocked: false });
  expect(await b.importUnclaimed(() => true)).toBe(2);
});
it('aborts partial work when the captured authentication session changes', async () => {
  const { a, b } = await fixture();
  let checks = 0;
  await expect(a.importUnclaimed(() => ++checks < 3)).rejects.toMatchObject({ name: 'AbortError' });
  expect(await a.all()).toEqual([]);
  expect(await a.pending()).toEqual([]);
  expect(await b.importUnclaimed(() => true)).toBe(2);
});
it('adopts identical downloaded records without requeuing and preserves the feed checkpoint', async () => {
  const { a } = await fixture();
  await a.applyPage(
    [
      {
        revision: '8',
        kind: 'exposure-open',
        record: { ...record('one'), recorded_at: '2026-10-28T00:00:00.000Z' }
      }
    ],
    'checkpoint'
  );
  expect(await a.importUnclaimed(() => true)).toBe(2);
  expect((await a.pending()).map((r) => r.id)).toEqual(['two']);
  expect(await a.getCursor()).toBe('checkpoint');
});
it('requires an account and never promotes server-only guest records', async () => {
  const { guest, a } = await fixture();
  await expect(guest.importUnclaimed(() => true)).rejects.toThrow('account');
  await guest.applyPage(
    [{ revision: '9', kind: 'milestone', record: { ...record('claim'), kind: 'milestone' } }],
    'guest'
  );
  expect(await a.importUnclaimed(() => true)).toBe(2);
  expect((await a.all()).some((r) => r.kind === 'milestone')).toBe(false);
});

import { openTrainingDb, reqToPromise, withTransaction } from './training-db';
import { OWNED_STORES } from './training-schema';
import { openLearningEvidenceDb } from './learning-evidence';
import { openLearningPilotDb } from './learning-pilot';

// The training, pilot and evidence databases all use compound owner-first keys.
// Guest and other account ranges must never be included in an account erasure.
export async function clearLearningPartition(owner: string, deleting = false) {
  if (!/^account:[\da-f-]{36}(:[1-9]\d*)?$/i.test(owner)) throw new Error('Invalid account owner');
  const base = owner.split(':').slice(0, 2).join(':');
  const keys = deleting
    ? IDBKeyRange.bound([base], [base + ';'], false, true)
    : IDBKeyRange.bound([owner], [owner, []]);
  const belongs = (value: unknown) =>
    typeof value === 'string' && (value === base || value.startsWith(base + ':'));

  async function clearRows(
    open: () => Promise<IDBDatabase>,
    names: string[],
    journal?: 'history' | 'evidence'
  ) {
    const db = await open();
    try {
      const stores = journal === 'history' && deleting ? [...names, OWNED_STORES.imports] : names;
      await withTransaction(db, stores, 'readwrite', async (s) => {
        await Promise.all(names.map((name) => reqToPromise(s[name].delete(keys))));
        if (!deleting || !journal) return;
        if (journal === 'history') {
          const imports = s[OWNED_STORES.imports];
          const rows = await reqToPromise(imports.getAll());
          for (const row of rows)
            if (belongs(row.ownerKey))
              await reqToPromise(imports.delete([row.installationId, row.kind, row.id]));
        } else {
          const rows = await reqToPromise(
            s.meta.getAll(IDBKeyRange.bound(['unclaimed'], ['unclaimed', []]))
          );
          for (const row of rows)
            if ((row.key === 'import-owner' || row.key.startsWith('import:')) && belongs(row.value))
              await reqToPromise(s.meta.delete(['unclaimed', row.key]));
        }
      });
    } finally {
      db.close();
    }
  }

  await Promise.all([
    clearRows(
      openTrainingDb,
      Object.values(OWNED_STORES).filter((name) => name !== OWNED_STORES.imports),
      'history'
    ),
    clearRows(openLearningPilotDb, ['attempts', 'sessions']),
    clearRows(openLearningEvidenceDb, ['records', 'outbox', 'meta'], 'evidence')
  ]);
}

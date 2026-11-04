/** Prospective evidence only: no migration or promotion of historical attempts. */
import { payloadKey } from './owned-training';
import { reqToPromise } from './training-db';
import { notifyTrainingDataChange } from './training-data-events';

export const LEARNING_EVIDENCE_DB_NAME = 'opencw_learning_evidence_v1';
export type EvidenceKind =
  | 'plan'
  | 'observation'
  | 'exposure-open'
  | 'exposure-close'
  | 'terminal'
  | 'milestone'
  | 'milestone-correction';
export interface EvidenceRecord extends Record<string, unknown> {
  id: string;
  kind: EvidenceKind;
  policy_version: string;
  recorded_at: string;
}
export interface EvidenceChange {
  revision: string;
  kind: EvidenceKind;
  record: EvidenceRecord;
}
interface Row {
  owner: string;
  id: string;
  record: EvidenceRecord;
  order: number;
  processId?: string;
}
interface Pending extends Row {
  error?: string;
  permanent?: boolean;
  /** Terminal record whose permanent rejection made this dependent impossible to submit. */
  blockedBy?: string;
}
interface Meta {
  owner: string;
  key: string;
  value: unknown;
}
const kinds: EvidenceKind[] = [
  'plan',
  'observation',
  'exposure-open',
  'exposure-close',
  'terminal',
  'milestone',
  'milestone-correction'
];
let processId: string | null = null;
let previousProcessId: string | null | undefined;
const PROCESS_KEY = 'opencw:learning-evidence-process';
const SHUTDOWN_KEY = 'opencw:learning-evidence-shutdown';
const sessionStorageSafe = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
};
/**
 * Session storage survives a reload in the same tab, but browsers also clone
 * it when duplicating a tab or opening a window. The stored id is therefore an
 * ownership hint, not proof that the previous document is dead. A clean
 * non-BFCache unload writes a separate marker so a normal reload can be
 * distinguished from a live cloned sibling.
 */
export const previousCaptureProcessId = () => {
  if (previousProcessId === undefined)
    previousProcessId = sessionStorageSafe()?.getItem(PROCESS_KEY) ?? null;
  return previousProcessId;
};
/**
 * Records that a document completed a normal unload. The marker is scoped to
 * the process id so a later clone (which inherits stale session storage) can
 * never mistake itself for the document that wrote it.
 */
export const markCaptureCleanShutdown = (process = captureProcessId()) => {
  try {
    sessionStorageSafe()?.setItem(SHUTDOWN_KEY, process);
  } catch {
    /* Private browsing or an unavailable session store. */
  }
};
export const previousCaptureWasClean = (process: string) => {
  try {
    return sessionStorageSafe()?.getItem(SHUTDOWN_KEY) === process;
  } catch {
    return false;
  }
};
export const captureProcessId = () => {
  if (processId) return processId;
  previousProcessId = sessionStorageSafe()?.getItem(PROCESS_KEY) ?? null;
  processId = crypto.randomUUID();
  try {
    sessionStorageSafe()?.setItem(PROCESS_KEY, processId);
  } catch {
    /* Private browsing or an unavailable session store. */
  }
  return processId;
};
const serverOnly = (kind: EvidenceKind) => kind === 'milestone' || kind === 'milestone-correction';

export function isEvidenceRecord(value: unknown): value is EvidenceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.trim().length > 0 &&
    r.id.length <= 128 &&
    typeof r.kind === 'string' &&
    kinds.includes(r.kind as EvidenceKind) &&
    r.policy_version === 'learning-policy-1.0' &&
    typeof r.recorded_at === 'string' &&
    Number.isFinite(Date.parse(r.recorded_at)) &&
    !('owner_key' in r) &&
    !('user_id' in r)
  );
}

/** Canonical wire normalization: sets and equivalent UTC timestamps keep retry identity. */
function normalized(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const array = value.map((entry) => normalized(entry));
    return ['targets', 'characters', 'introduced_characters', 'observation_ids'].includes(key)
      ? array.sort()
      : array;
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalized(v, k)]));
  if (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  ) {
    const time = new Date(value);
    if (!Number.isNaN(time.getTime())) {
      const fraction = (value.match(/\.(\d+)/)?.[1] ?? '').replace(/0+$/, '');
      return time.toISOString().slice(0, 19) + (fraction ? `.${fraction}` : '') + 'Z';
    }
  }
  return value;
}
export const evidenceKey = (record: EvidenceRecord) => payloadKey(normalized(record));

async function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (stores: Record<string, IDBObjectStore>) => Promise<T>
): Promise<T> {
  const tx = db.transaction(['records', 'outbox', 'meta'], mode);
  const done = new Promise<DOMException | null>((resolve) => {
    tx.oncomplete = () => resolve(null);
    tx.onabort = () =>
      resolve(tx.error ?? new DOMException('Evidence transaction aborted', 'AbortError'));
  });
  try {
    const result = await operation(
      Object.fromEntries(['records', 'outbox', 'meta'].map((name) => [name, tx.objectStore(name)]))
    );
    const error = await done;
    if (error) throw error;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
    await done;
    throw error;
  }
}
export function openLearningEvidenceDb(
  factory?: IDBFactory,
  name = LEARNING_EVIDENCE_DB_NAME
): Promise<IDBDatabase> {
  const idb = factory ?? (typeof window === 'undefined' ? undefined : window.indexedDB);
  if (!idb) return Promise.reject(new Error('Evidence storage unavailable'));
  return new Promise((resolve, reject) => {
    const request = idb.open(name, 1);
    let cancelled = false;
    const fail = (error: Error) => {
      cancelled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error('Evidence storage timed out'));
      try {
        request.transaction?.abort();
      } catch {
        /* Settled. */
      }
    }, 10000);
    request.onupgradeneeded = () => {
      if (cancelled) {
        request.transaction?.abort();
        return;
      }
      for (const store of ['records', 'outbox'])
        request.result
          .createObjectStore(store, { keyPath: ['owner', 'id'] })
          .createIndex('owner', 'owner');
      request.result.createObjectStore('meta', { keyPath: ['owner', 'key'] });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (cancelled) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? new Error('Cannot open evidence storage'));
    request.onblocked = () => fail(new Error('Evidence storage is blocked by another tab'));
  });
}
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Direct upload dependencies defined by the additive evidence contract. */
function dependencyIds(
  record: EvidenceRecord,
  recordsById: ReadonlyMap<string, Row>,
  plansBySession: ReadonlyMap<string, string[]>
): string[] {
  const session = typeof record.session_id === 'string' ? record.session_id : '';
  switch (record.kind) {
    case 'exposure-open':
      // A session-scoped guard is capture evidence for a specific plan. The
      // server enforces the same dependency, so a permanently rejected plan
      // must terminalize its guards instead of retrying them forever.
      return session ? [...(plansBySession.get(session) ?? [])] : [];
    case 'observation': {
      const dependencies = session ? [...(plansBySession.get(session) ?? [])] : [];
      const presentation = typeof record.presentation_id === 'string' ? record.presentation_id : '';
      if (presentation)
        for (const row of recordsById.values())
          if (row.record.kind === 'exposure-open' && row.record.presentation_id === presentation)
            dependencies.push(row.id);
      return dependencies;
    }
    case 'exposure-close':
      return typeof record.open_id === 'string' ? [record.open_id] : [];
    case 'terminal':
      return [
        ...(session ? (plansBySession.get(session) ?? []) : []),
        ...stringList(record.observation_ids)
      ];
    default:
      return [];
  }
}

/**
 * Marks pending dependents of permanently rejected records as terminal.
 * They remain in the outbox with their original evidence for diagnosis, but
 * are no longer retryable and no longer count as pending upload work.
 */
async function blockDependentRejections(
  stores: Record<string, IDBObjectStore>,
  owner: string
): Promise<void> {
  const records = await reqToPromise<Row[]>(stores.records.index('owner').getAll(owner));
  const outbox = (await reqToPromise<Pending[]>(stores.outbox.getAll())).filter(
    (row) => row.owner === owner
  );
  const permanent = new Set(outbox.filter((row) => row.permanent).map((row) => row.id));
  if (!permanent.size) return;
  const recordsById = new Map(records.map((row) => [row.id, row]));
  const plansBySession = new Map<string, string[]>();
  for (const row of records)
    if (row.record.kind === 'plan' && typeof row.record.session_id === 'string') {
      const plans = plansBySession.get(row.record.session_id);
      if (plans) plans.push(row.id);
      else plansBySession.set(row.record.session_id, [row.id]);
    }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of outbox) {
      if (row.permanent) continue;
      const blockedBy = dependencyIds(row.record, recordsById, plansBySession).find((id) =>
        permanent.has(id)
      );
      if (!blockedBy) continue;
      const blocked: Pending = {
        ...row,
        error: 'EVIDENCE_DEPENDENCY_REJECTED',
        permanent: true,
        blockedBy
      };
      await reqToPromise(stores.outbox.put(blocked));
      Object.assign(row, blocked);
      permanent.add(row.id);
      changed = true;
    }
  }
}

export function createLearningEvidenceRepository(db: IDBDatabase, owner: string) {
  if (!owner.trim()) throw new Error('Evidence requires an owner');
  const rows = <T>(store: IDBObjectStore) => reqToPromise<T[]>(store.index('owner').getAll(owner));
  const notify = (local = false, records = false) =>
    notifyTrainingDataChange(owner, local, 'learning-evidence', records);
  return {
    async append(records: readonly EvidenceRecord[]) {
      let changed = false;
      await transaction(db, 'readwrite', async (s) => {
        const meta = await reqToPromise<Meta | undefined>(s.meta.get([owner, 'order']));
        let order = Number(meta?.value ?? 0);
        for (const source of records) {
          if (!isEvidenceRecord(source) || serverOnly(source.kind))
            throw new Error('Invalid client evidence');
          const record = structuredClone(source);
          const existing = await reqToPromise<Row | undefined>(s.records.get([owner, record.id]));
          if (existing) {
            if (evidenceKey(existing.record) !== evidenceKey(record))
              throw new Error('Immutable evidence conflict');
            continue;
          }
          const row: Row = {
            owner,
            id: record.id,
            record,
            order: ++order,
            processId: captureProcessId()
          };
          await reqToPromise(s.records.add(row));
          if (owner.startsWith('account:')) await reqToPromise(s.outbox.add(row));
          changed = true;
        }
        await reqToPromise(s.meta.put({ owner, key: 'order', value: order }));
      });
      // Duplicate-only appends write no record and cannot change a projection.
      if (changed) notify(true, true);
    },
    async checkpoints(): Promise<unknown[]> {
      return transaction(db, 'readonly', async (s) =>
        (await reqToPromise<Meta[]>(s.meta.getAll()))
          .filter((r) => r.owner === owner && r.key.startsWith('checkpoint:'))
          .map((r) => r.value)
      );
    },
    async getCheckpoint(id: string): Promise<unknown> {
      return transaction(
        db,
        'readonly',
        async (s) =>
          (await reqToPromise<Meta | undefined>(s.meta.get([owner, `checkpoint:${id}`])))?.value ??
          null
      );
    },
    async setCheckpoint(id: string, value: unknown) {
      await transaction(db, 'readwrite', async (s) => {
        if (value === null) await reqToPromise(s.meta.delete([owner, `checkpoint:${id}`]));
        else await reqToPromise(s.meta.put({ owner, key: `checkpoint:${id}`, value }));
      });
    },
    async getImportStatus() {
      return transaction(db, 'readonly', async (s) => {
        const assignment = await reqToPromise<Meta | undefined>(
          s.meta.get(['unclaimed', 'import-owner'])
        );
        if (assignment && assignment.value !== owner) return { count: 0, blocked: true };
        let count = 0;
        const guest = await reqToPromise<Row[]>(s.records.index('owner').getAll('unclaimed'));
        for (const row of guest)
          if (
            !serverOnly(row.record.kind) &&
            !(await reqToPromise(s.meta.get(['unclaimed', `import:${row.id}`])))
          )
            count++;
        return { count, blocked: false };
      });
    },
    /** One destination for the source ledger keeps its complete exposure chronology together. */
    async importUnclaimed(isCurrent: () => boolean): Promise<number> {
      if (!owner.startsWith('account:')) throw new Error('Evidence import requires an account');
      const current = () => {
        if (!isCurrent()) throw new DOMException('Evidence owner changed', 'AbortError');
      };
      const count = await transaction(db, 'readwrite', async (s) => {
        current();
        const assignment = await reqToPromise<Meta | undefined>(
          s.meta.get(['unclaimed', 'import-owner'])
        );
        if (assignment && assignment.value !== owner)
          throw new Error('Guest evidence already assigned');
        const guest = (
          await reqToPromise<Row[]>(s.records.index('owner').getAll('unclaimed'))
        ).sort((a, b) => a.order - b.order);
        let order = Number(
            (await reqToPromise<Meta | undefined>(s.meta.get([owner, 'order'])))?.value ?? 0
          ),
          imported = 0;
        for (const source of guest) {
          current();
          if (
            serverOnly(source.record.kind) ||
            (await reqToPromise(s.meta.get(['unclaimed', `import:${source.id}`])))
          )
            continue;
          if (!isEvidenceRecord(source.record)) throw new Error('Invalid guest evidence');
          const existing = await reqToPromise<Row | undefined>(s.records.get([owner, source.id]));
          if (existing && evidenceKey(existing.record) !== evidenceKey(source.record))
            throw new Error('Guest evidence ID conflict');
          if (!existing) {
            const row = { ...source, owner, order: ++order };
            await reqToPromise(s.records.add(row));
            await reqToPromise(s.outbox.add(row));
          }
          await reqToPromise(
            s.meta.add({ owner: 'unclaimed', key: `import:${source.id}`, value: owner })
          );
          imported++;
        }
        if (imported)
          await reqToPromise(s.meta.put({ owner: 'unclaimed', key: 'import-owner', value: owner }));
        await reqToPromise(s.meta.put({ owner, key: 'order', value: order }));
        current();
        return imported;
      });
      if (count) notify(true, true);
      return count;
    },
    async orphanCandidates() {
      return transaction(db, 'readonly', async (s) => {
        const all = await rows<Row>(s.records);
        const closed = new Set(
          all.filter((r) => r.record.kind === 'exposure-close').map((r) => r.record.open_id)
        );
        const finalized = new Set(
          all.filter((r) => r.record.kind === 'terminal').map((r) => r.record.session_id)
        );
        return all
          .filter(
            (r) =>
              r.processId &&
              r.processId !== captureProcessId() &&
              ((r.record.kind === 'exposure-open' && !closed.has(r.id)) ||
                (r.record.kind === 'plan' && !finalized.has(r.record.session_id)))
          )
          .map((r) => ({ record: r.record, processId: r.processId! }));
      });
    },
    async all(): Promise<EvidenceRecord[]> {
      return transaction(db, 'readonly', async (s) =>
        (await rows<Row>(s.records)).sort((a, b) => a.order - b.order).map((r) => r.record)
      );
    },
    async pending(): Promise<EvidenceRecord[]> {
      return transaction(db, 'readwrite', async (s) => {
        await blockDependentRejections(s, owner);
        return (await rows<Pending>(s.outbox))
          .filter((r) => !r.permanent)
          .sort((a, b) => a.order - b.order)
          .map((r) => r.record);
      });
    },
    /** Terminal evidence IDs kept locally but never retried. */
    async rejectedIds(): Promise<string[]> {
      return transaction(db, 'readwrite', async (s) => {
        await blockDependentRejections(s, owner);
        return (await rows<Pending>(s.outbox))
          .filter((r) => r.permanent)
          .sort((a, b) => a.order - b.order)
          .map((r) => r.id);
      });
    },
    async acknowledge(ids: readonly string[]) {
      if (!ids.length) return;
      let changed = false;
      await transaction(db, 'readwrite', async (s) => {
        for (const id of ids) {
          const existing = await reqToPromise(s.outbox.get([owner, id]));
          if (!existing) continue;
          await reqToPromise(s.outbox.delete([owner, id]));
          changed = true;
        }
      });
      if (changed) notify();
    },
    async reject(id: string, error: string, permanent: boolean) {
      let changed = false;
      await transaction(db, 'readwrite', async (s) => {
        const row = await reqToPromise<Pending | undefined>(s.outbox.get([owner, id]));
        // A permanent rejection is terminal. A later retryable or concurrent
        // response must never downgrade it and restart an endless upload loop.
        if (!row || row.permanent) return;
        await reqToPromise(s.outbox.put({ ...row, error, permanent }));
        if (permanent) await blockDependentRejections(s, owner);
        changed = true;
      });
      // Only a permanent rejection changes rejectedIds() and excludes claims.
      if (changed) notify(false, permanent);
    },
    async applyPage(
      changes: readonly EvidenceChange[],
      cursor: string,
      expectedCursor?: string | null
    ) {
      let changed = false;
      await transaction(db, 'readwrite', async (s) => {
        const previous = await reqToPromise<Meta | undefined>(s.meta.get([owner, 'cursor']));
        if (expectedCursor !== undefined && (previous?.value ?? null) !== expectedCursor)
          throw new Error('Evidence checkpoint changed');
        for (const change of changes) {
          if (
            !isEvidenceRecord(change.record) ||
            change.kind !== change.record.kind ||
            !/^\d+$/.test(change.revision)
          )
            throw new Error('Invalid evidence change');
          const existing = await reqToPromise<Row | undefined>(
            s.records.get([owner, change.record.id])
          );
          if (existing && evidenceKey(existing.record) !== evidenceKey(change.record))
            throw new Error('Downloaded evidence conflict');
          if (!existing) changed = true;
          await reqToPromise(
            s.records.put({
              owner,
              id: change.record.id,
              record: change.record,
              order: existing?.order ?? Number(change.revision),
              ...(existing?.processId ? { processId: existing.processId } : {})
            })
          );
        }
        await reqToPromise(s.meta.put({ owner, key: 'cursor', value: cursor }));
      });
      // A checkpoint-only page is a successful no-op; keep mounted views stable.
      if (changed) notify(false, true);
    },
    async getCursor(): Promise<string | null> {
      return transaction(
        db,
        'readonly',
        async (s) =>
          ((await reqToPromise<Meta | undefined>(s.meta.get([owner, 'cursor'])))
            ?.value as string) ?? null
      );
    },
    async resetCursor(expectedCursor?: string | null) {
      await transaction(db, 'readwrite', async (s) => {
        const previous = await reqToPromise<Meta | undefined>(s.meta.get([owner, 'cursor']));
        if (expectedCursor !== undefined && (previous?.value ?? null) !== expectedCursor)
          throw new Error('Evidence checkpoint changed');
        await reqToPromise(s.meta.delete([owner, 'cursor']));
      });
    },
    async clientId(): Promise<string> {
      return transaction(db, 'readwrite', async (s) => {
        const previous = await reqToPromise<Meta | undefined>(s.meta.get([owner, 'client']));
        if (previous) return String(previous.value);
        const value = crypto.randomUUID();
        await reqToPromise(s.meta.put({ owner, key: 'client', value }));
        return value;
      });
    },
    async getSyncStatus() {
      return transaction(db, 'readwrite', async (s) => {
        await blockDependentRejections(s, owner);
        const outbox = await rows<Pending>(s.outbox);
        const retryable = outbox.filter((r) => !r.permanent);
        const rejected = outbox.filter((r) => r.permanent && !r.blockedBy);
        const blocked = outbox.filter((r) => r.permanent && r.blockedBy);
        return {
          pending: retryable.length,
          rejected: rejected.length,
          blocked: blocked.length,
          error: retryable.find((r) => r.error)?.error ?? null
        };
      });
    }
  };
}
export type LearningEvidenceRepository = ReturnType<typeof createLearningEvidenceRepository>;

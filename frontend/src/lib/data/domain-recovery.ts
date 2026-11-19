import {
  evidenceKey,
  isEvidenceRecord,
  LEARNING_EVIDENCE_DB_NAME,
  openLearningEvidenceDb
} from './learning-evidence';
import { LEARNING_PILOT_DB_NAME, openLearningPilotDb } from './learning-pilot';
import { canonicalImportRecord } from './training-sync-repository';
import type { AttemptEvent, TrainingSessionRecord } from '../training/v2/types';
import { payloadKey } from './owned-training';
import { openTrainingDb, reqToPromise, withTransaction } from './training-db';
import { TRAINING_DB_NAME, OWNED_STORES, TRAINING_STORES } from './training-schema';

const LEGACY_ORIGIN = 'https://opencw.net';
export const RECOVERY_ORIGIN = 'https://morsewell.com';
const marker = 'morsewell:opencw-recovery:v1';
const databases = new Map<string, (factory?: IDBFactory) => Promise<IDBDatabase>>([
  [TRAINING_DB_NAME, openTrainingDb],
  [LEARNING_PILOT_DB_NAME, openLearningPilotDb],
  [LEARNING_EVIDENCE_DB_NAME, openLearningEvidenceDb]
]);
// Keep both ends allowlisted. Account tokens and browser session state stay on their origin.
const preference =
  /^(?:learn\.lesson|cw\.settings(?:\.updated_at)?\.v1(?:\.account\.[\w-]+)?|cw\.progress\.queue\.v1|theme|PARAGLIDE_LOCALE_PREF)$/;

export interface DeviceDatabaseSnapshot {
  name: string;
  version: number;
  stores: Record<string, Record<string, unknown>[]>;
}

interface Recovery {
  snapshots: DeviceDatabaseSnapshot[];
  preferences: [string, string][];
}

type LocalRow = Record<string, unknown>;
interface PreparedStore {
  name: string;
  rows: LocalRow[];
  fingerprints: string[];
}

async function prepareStores(db: IDBDatabase, snapshot: DeviceDatabaseSnapshot) {
  if (snapshot.version > db.version) throw Error('version');
  const stores = { ...snapshot.stores };
  if (snapshot.name === TRAINING_DB_NAME && snapshot.version === 1) {
    // Mirror the v1 → v2 schema upgrade for installations older than owned training stores.
    for (const name of ['attempts', 'sessions'] as const) {
      stores[OWNED_STORES[name]] = stores[TRAINING_STORES[name]].map((row) => ({
        ...row,
        ownerKey: 'unclaimed'
      }));
    }
  }
  const prepared: PreparedStore[] = [];
  const encoder = new TextEncoder();
  for (const [name, rows] of Object.entries(stores)) {
    if (!db.objectStoreNames.contains(name) || !Array.isArray(rows)) throw Error('invalid');
    const fingerprints: string[] = [];
    // Hashes identify already-copied source rows without keeping duplicate learner data.
    // Bound the number of in-flight operations on a long training history.
    if (db.objectStoreNames.contains('meta')) {
      for (let offset = 0; offset < rows.length; offset += 128) {
        const chunk = await Promise.all(
          rows.slice(offset, offset + 128).map(async (row) => {
            // Retry counters and local capture order do not create a new upload.
            let identity: unknown = row;
            if (name === OWNED_STORES.outbox)
              identity = [row.ownerKey, row.kind, row.id, row.payloadKey ?? row.payload];
            else if (
              db.name === LEARNING_EVIDENCE_DB_NAME &&
              name === 'outbox' &&
              isEvidenceRecord(row.record)
            )
              identity = [row.owner, row.id, evidenceKey(row.record)];
            const hash = await crypto.subtle.digest(
              'SHA-256',
              encoder.encode(payloadKey([name, identity]))
            );
            return btoa(String.fromCharCode(...new Uint8Array(hash)));
          })
        );
        fingerprints.push(...chunk);
      }
    }
    prepared.push({ name, rows, fingerprints });
  }
  return prepared;
}

function sameRecord(name: string, existing: LocalRow, row: LocalRow, evidence: boolean) {
  if (payloadKey(existing) === payloadKey(row)) return true;
  if (
    evidence &&
    (name === 'records' || name === 'outbox') &&
    isEvidenceRecord(existing.record) &&
    isEvidenceRecord(row.record)
  ) {
    return evidenceKey(existing.record) === evidenceKey(row.record);
  }
  if (name === OWNED_STORES.attempts || name === OWNED_STORES.sessions) {
    const kind = name === OWNED_STORES.attempts ? 'attempt' : 'session';
    try {
      const key = (value: LocalRow) =>
        canonicalImportRecord(kind, value as unknown as AttemptEvent | TrainingSessionRecord);
      return key(existing) === key(row);
    } catch {
      // Unfinished sessions and summaries can only match by their complete local payload.
    }
  }
  return false;
}

async function mergeDatabase(db: IDBDatabase, prepared: PreparedStore[], commit: boolean) {
  const evidence = db.name === LEARNING_EVIDENCE_DB_NAME;
  const markerKey = evidence ? ['unclaimed', marker] : marker;
  return withTransaction(
    db,
    prepared.map((store) => store.name),
    commit ? 'readwrite' : 'readonly',
    async (target) => {
      const ledger = target.meta;
      const journal = ledger ? await reqToPromise(ledger.get(markerKey)) : null;
      const seen = new Set<string>(journal?.value);
      const initialSize = seen.size;
      const installation =
        !evidence && ledger ? (await reqToPromise(ledger.get('installationId')))?.value : null;
      if (evidence && ledger && target.records) {
        // An evidence ledger can be assigned to only one account. Never attach an
        // independently-created guest history on one site to an account from the other.
        const oldOwner = prepared
          .find((s) => s.name === 'meta')
          ?.rows.find((r) => r.owner === 'unclaimed' && r.key === 'import-owner')?.value;
        const newOwner = (await reqToPromise(ledger.get(['unclaimed', 'import-owner'])))?.value;
        if (oldOwner !== newOwner) {
          const incoming = prepared.find((s) => s.name === 'records');
          const newGuestRecords = incoming?.rows.some(
            (r, i) => r.owner === 'unclaimed' && !seen.has(incoming.fingerprints[i])
          );
          if (
            (newOwner && newGuestRecords) ||
            (oldOwner && (await reqToPromise(target.records.index('owner').count('unclaimed'))))
          ) {
            throw Error('conflict');
          }
        }
      }
      let inserted = 0;
      for (const { name, rows, fingerprints } of prepared) {
        const store = target[name];
        for (const [index, source] of rows.entries()) {
          const fingerprint = fingerprints[index];
          if (seen.has(fingerprint)) continue;
          if (fingerprint) seen.add(fingerprint);
          if (
            (name === OWNED_STORES.meta && source.key === 'downloadCursor') ||
            (evidence && name === 'meta' && ['cursor', 'client'].includes(String(source.key)))
          )
            continue;
          const row: LocalRow =
            name === OWNED_STORES.imports && installation
              ? { ...source, installationId: installation }
              : source;
          const fields = store.keyPath;
          if (!row || !fields) throw Error('invalid');
          const key = Array.isArray(fields) ? fields.map((field) => row[field]) : row[fields];
          const existing = await reqToPromise(store.get(key as IDBValidKey));
          if (existing === undefined) {
            if (commit) await reqToPromise(store.add(row));
            inserted++;
          } else if (
            !evidence &&
            (name === TRAINING_STORES.settings || name === TRAINING_STORES.meta)
          ) {
            continue;
          } else if (evidence && name === 'meta' && row.key === 'order') {
            if (commit)
              await reqToPromise(
                store.put({ ...existing, value: Math.max(existing.value, Number(row.value)) })
              );
          } else if (!sameRecord(name, existing, row, evidence)) {
            throw Error('conflict');
          }
        }
      }
      // Acknowledged uploads and finished checkpoints must stay consumed on retries,
      // even if an old offline tab appended more data after the first recovery.
      if (commit && ledger && seen.size !== initialSize)
        await reqToPromise(ledger.put({ owner: 'unclaimed', key: marker, value: [...seen] }));
      return inserted;
    }
  );
}

export async function restoreDeviceHistory(
  data: Recovery,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  factory?: IDBFactory
) {
  if (!Array.isArray(data.snapshots) || !Array.isArray(data.preferences)) throw Error('invalid');
  for (const entry of data.preferences) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !preference.test(entry[0]) ||
      typeof entry[1] !== 'string'
    )
      throw Error('invalid');
  }
  const opened: IDBDatabase[] = [];
  const copies: PreparedStore[][] = [];
  let count = 0;
  try {
    for (const snapshot of data.snapshots) {
      const open = databases.get(snapshot.name);
      if (!open) throw Error('invalid');
      const db = await open(factory);
      opened.push(db);
      const prepared = await prepareStores(db, snapshot);
      copies.push(prepared);
      await mergeDatabase(db, prepared, false);
    }
    // Check every database for existing conflicts before committing any records.
    // Recheck under the write transaction in case another tab changed the destination.
    for (const [index, db] of opened.entries())
      count += await mergeDatabase(db, copies[index], true);
  } finally {
    for (const db of opened) db.close();
  }
  const preferences = new Map(data.preferences);
  for (const [key, value] of preferences) {
    // A timestamp must never mark another profile's or the destination's own
    // preferences as a pending remote change.
    if (key.startsWith('cw.settings.updated_at.v1')) {
      const setting = key.replace('cw.settings.updated_at.v1', 'cw.settings.v1');
      const current = storage.getItem(setting);
      if (!preferences.has(setting) || (current !== null && current !== preferences.get(setting)))
        continue;
    }
    if (storage.getItem(key) === null) {
      storage.setItem(key, value);
      count++;
    }
  }
  return count;
}

export async function recoverDeviceHistory(): Promise<number> {
  if (window.location.origin !== RECOVERY_ORIGIN || window.top !== window) throw Error('origin');
  const popup = window.open(LEGACY_ORIGIN + '/recover-device.html', '_blank', 'popup');
  if (!popup) throw Error('popup');
  const data = await new Promise<Recovery>((resolve, reject) => {
    const timeout = setTimeout(() => finish(() => reject(Error('timeout'))), 60_000);
    const closed = setInterval(() => {
      if (popup.closed) finish(() => reject(Error('closed')));
    }, 500);
    function finish(done: () => void) {
      clearTimeout(timeout);
      clearInterval(closed);
      window.removeEventListener('message', receive);
      popup?.close();
      done();
    }
    function receive(event: MessageEvent) {
      if (event.origin !== LEGACY_ORIGIN || event.source !== popup) return;
      if (event.data === 'morsewell:ready') popup?.postMessage('morsewell:read', LEGACY_ORIGIN);
      else if (event.data?.type === 'morsewell:records') finish(() => resolve(event.data));
      else if (event.data?.type === 'morsewell:error') finish(() => reject(Error('unavailable')));
    }
    window.addEventListener('message', receive);
  });
  return restoreDeviceHistory(data, localStorage);
}

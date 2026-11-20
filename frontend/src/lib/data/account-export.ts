import { getEmailPreferences, getSettings, getUserInfo } from '../api';
import { apiFetch, assertAuthSessionCurrent, getAuthAccountId, getAuthSession } from '../auth';
import { readClientCwSettings } from '../cwSync';
import { LOCALE_PREFERENCE_STORAGE_KEY, normalizeLocalePreference } from '../locale';
import { readStoredTheme } from '../theme.svelte';
import { getTrainingOwner, trainingEpoch } from '../training-owner';
import { attemptToWire } from '../training-wire';
import type { AttemptEvent, HistorySessionRecord } from '../training/v2/types';
import {
  createLearningEvidenceRepository,
  evidenceKey,
  type EvidenceRecord,
  isEvidenceRecord,
  openLearningEvidenceDb
} from './learning-evidence';
import { loadLearningPilotHistory } from './learning-pilot';
import { ownedRecords, type FrozenOutboxRecord } from './owned-training';
import { validCheckpoint } from './session-checkpoints';
import { openTrainingDb, withTransaction } from './training-db';
import { OWNED_STORES } from './training-schema';

type Fields = Record<string, unknown>;
function select(record: object, keys: string) {
  const fields = record as Fields;
  return Object.fromEntries(
    keys
      .split(' ')
      .filter((k) => Object.hasOwn(fields, k))
      .map((k) => [k, fields[k]])
  );
}

async function deviceTraining(owner: string) {
  const db = await openTrainingDb();
  const { attempts, sessions, outbox } = OWNED_STORES;
  try {
    return await withTransaction(db, [attempts, sessions, outbox], 'readonly', (s) =>
      Promise.all([
        ownedRecords<AttemptEvent>(s[attempts], owner),
        ownedRecords<HistorySessionRecord>(s[sessions], owner),
        ownedRecords<FrozenOutboxRecord>(s[outbox], owner)
      ])
    );
  } finally {
    db.close();
  }
}

async function deviceEvidence(owner: string) {
  const db = await openLearningEvidenceDb();
  try {
    const repository = createLearningEvidenceRepository(db, owner);
    return await Promise.all([repository.all(), repository.checkpoints()]);
  } finally {
    db.close();
  }
}

const attemptFields =
  'id session_id prompt_id prompt_kind target_character entered_text is_correct classification latency_ms replay_count input_mode char_wpm eff_wpm freq_hz created_at';
const sessionFields =
  'session_id schema_version mode source_kind source_record_id curriculum_version lesson status char_wpm eff_wpm freq_hz started_at ended_at occurred_at occurred_at_source prompt_count attempt_count event_ids scored_attempt_count correct_attempt_count accuracy scoring_version received_at';
const localSessionFields =
  'schemaVersion id mode accuracy step charWpm effWpm freqHz startedAt completedAt occurredAt occurredAtSource sourceKind sourceRecordId status promptCount completedPromptCount eventIds';

/** Read complete, fixed-ceiling cloud feeds without advancing this device's sync checkpoints. */
async function readChanges(
  path: string,
  get: (path: string) => Promise<Fields>,
  append: (kind: string, record: Fields) => void
) {
  let cursor = '';
  const seen = new Set<string>();
  for (;;) {
    const page = await get(
      `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    );
    if (
      !Array.isArray(page.changes) ||
      typeof page.has_more !== 'boolean' ||
      typeof page.next_cursor !== 'string' ||
      !page.next_cursor
    )
      throw Error('Invalid account export page');
    for (const change of page.changes) {
      if (
        typeof change?.kind !== 'string' ||
        !change.record ||
        typeof change.record !== 'object' ||
        Array.isArray(change.record)
      )
        throw Error('Invalid account export record');
      append(change.kind, change.record);
    }
    if (!page.has_more) return;
    cursor = page.next_cursor;
    if (!page.changes.length || seen.has(cursor)) throw Error('Stalled account export');
    seen.add(cursor);
  }
}

export async function downloadAccountData(cancel: AbortSignal): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw Error('Browser required');
  const requests = new AbortController();
  const signal = AbortSignal.any([cancel, requests.signal]);
  const session = getAuthSession(),
    id = getAuthAccountId(),
    owner = getTrainingOwner();
  if (!id || !session.username || !owner.startsWith('account:')) throw Error('Sign-in required');
  const current = () => {
    signal.throwIfAborted();
    assertAuthSessionCurrent(session);
    if (getTrainingOwner() !== owner) throw Error('Account history changed');
  };
  const get = async (path: string): Promise<Fields> => {
    for (;;) {
      current();
      const response = await apiFetch(path, { signal, cache: 'no-store' });
      const epoch = response.headers.get('X-Training-Epoch');
      if (epoch !== null && epoch !== String(trainingEpoch(owner)))
        throw Error('Account history changed');
      const data = await response.json().catch(() => null);
      current();
      if (response.ok && data) return data;
      // Older accounts are backfilled in batches by this read. Each retry advances bootstrap.
      if (response.status !== 503 || data?.code !== 'TRAINING_SYNC_INITIALIZING')
        throw Error('Account export unavailable');
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  };
  current();
  const attempts = new Map<string, Fields>(),
    sessions = new Map<string, Fields>(),
    evidence = new Map<string, EvidenceRecord>();
  const [profile, settings, email, snapshot, native, [records, checkpoints], pilot] =
    await Promise.all([
      getUserInfo(),
      getSettings(),
      getEmailPreferences(),
      get('/training/snapshot'),
      deviceTraining(owner),
      deviceEvidence(owner),
      loadLearningPilotHistory(owner),
      readChanges('/training/changes', get, (kind, record) => {
        if (kind === 'attempt' && typeof record.id === 'string')
          attempts.set(record.id, select(record, attemptFields));
        else if (kind === 'session' && typeof record.session_id === 'string')
          sessions.set(record.session_id, select(record, sessionFields));
        else throw Error('Invalid training history');
      }),
      readChanges('/training/learning-evidence/changes', get, (kind, record) => {
        if (!isEvidenceRecord(record) || record.kind !== kind)
          throw Error('Invalid learning evidence');
        evidence.set(record.id, record);
      })
    ]).catch((error) => {
      requests.abort();
      throw error;
    });
  current();
  if (
    !profile.username ||
    typeof email.support !== 'boolean' ||
    !Array.isArray(snapshot.character_masteries)
  )
    throw Error('Invalid account export');
  const [localAttempts, localSessions, outbox] = native;
  // Keep conflicting local versions even when the server already has that ID.
  const conflicts = new Set(
    outbox.filter((entry) => entry.permanentError).map((entry) => `${entry.kind}:${entry.id}`)
  );
  const exportedAt = new Date().toISOString();
  const archive = {
    schema_version: 1,
    exported_at: exportedAt,
    account: {
      id,
      ...select(
        profile,
        'username email email_verified call_sign created_at password_enabled google_linked'
      )
    },
    preferences: {
      sound: select(
        settings.cw_settings,
        'char_wpm eff_wpm freq start_delay target_daily_minutes updated_at'
      ),
      page: select(settings.page_settings, 'language cur_lesson updated_at'),
      email: select(email, 'support product'),
      device: {
        theme: readStoredTheme(),
        language: normalizeLocalePreference(localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)),
        sound: readClientCwSettings()
      }
    },
    learning_progress: {
      ...select(snapshot, 'suggested_step unlocked_step last_active_at'),
      character_masteries: snapshot.character_masteries.map((row) =>
        select(row, 'character status rolling_accuracy median_latency_ms total_attempts')
      ),
      attempts: [...attempts.values()],
      sessions: [...sessions.values()],
      evidence: [...evidence.values()],
      this_device: {
        attempts: localAttempts
          .filter((a) => !attempts.has(a.id) || conflicts.has(`attempt:${a.id}`))
          .map(attemptToWire),
        sessions: localSessions
          .filter((s) => !sessions.has(s.id) || conflicts.has(`session:${s.id}`))
          .map((s) => select(s, localSessionFields)),
        evidence: records.filter((r) => {
          const copy = evidence.get(r.id);
          return !copy || evidenceKey(copy) !== evidenceKey(r);
        }),
        saved_sessions: checkpoints.filter(validCheckpoint),
        pilot_history: pilot.map((p) => ({ ...p, attempts: p.attempts.map(attemptToWire) }))
      }
    }
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
  );
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `morsewell-account-${exportedAt.slice(0, 10)}.json`;
    current();
    link.click();
  } finally {
    // Let the browser take ownership of the download before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

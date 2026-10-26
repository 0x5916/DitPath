import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchApiResponse } from './request-timeout';
import { IDBFactory } from 'fake-indexeddb';
import { createAttemptRepository } from './data/attempt-repository';
import { createSessionRepository } from './data/session-repository';
import { closeTrainingDb, openTrainingDb } from './data/training-db';
import { createTrainingSyncRepository } from './data/training-sync-repository';
import { reduceCharacterMastery } from './training/v2/mastery';
import type { AttemptEvent, TrainingSessionRecord } from './training/v2/types';
import {
  synchronizeTraining,
  TrainingSyncError,
  type TrainingSyncPorts
} from './training-sync-engine';
import { attemptToWire } from './training-wire';

const owner = 'account:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now = '2026-10-20T00:10:00.000Z';
const baseSession: TrainingSessionRecord = {
  schemaVersion: 1,
  id: 'guided',
  mode: 'guided',
  step: 1,
  charWpm: 20,
  effWpm: 12,
  freqHz: 600,
  startedAt: '2026-10-20T00:00:00.000Z',
  status: 'in-progress',
  promptCount: 8,
  completedPromptCount: 0
};
const baseAttempt: AttemptEvent = {
  schemaVersion: 1,
  id: 'attempt',
  sessionId: 'guided',
  promptId: 'prompt',
  promptKind: 'recall',
  targetCharacter: 'K',
  enteredText: 'K',
  isCorrect: true,
  classification: 'automatic',
  latencyMs: 1000,
  replayCount: 0,
  inputMode: 'keyboard',
  charWpm: 20,
  effWpm: 12,
  freqHz: 600,
  createdAt: '2026-10-20T00:01:00.000Z'
};
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });
const emptyPage = (cursor = 'checkpoint') => ({
  changes: [],
  next_cursor: cursor,
  has_more: false
});
type WireRecord = Record<string, unknown>;

/** Small committed-record server seam: stable IDs deduplicate retries and feed pages use a fixed upper bound. */
function memoryServer() {
  const attempts = new Map<string, WireRecord>();
  const sessions = new Map<string, WireRecord>();
  const changes: { revision: string; kind: string; record: WireRecord }[] = [];
  const requests: { path: string; body?: WireRecord }[] = [];
  const server = {
    attempts,
    sessions,
    changes,
    requests,
    dropResponseFor: '',
    rejectAttemptId: '',
    async request(path: string, init?: RequestInit): Promise<Response> {
      const body = init?.body ? (JSON.parse(String(init.body)) as WireRecord) : undefined;
      requests.push({ path, body });
      if (path.includes('/events/batch') || path.includes('/sessions/batch')) {
        const kind = path.includes('/events/') ? 'attempt' : 'session';
        const records = body![kind === 'attempt' ? 'events' : 'sessions'] as WireRecord[];
        const acknowledged: string[] = [];
        const rejected: { id: string; error_code: string; retryable: boolean }[] = [];
        for (const record of records) {
          const id = String(record[kind === 'attempt' ? 'id' : 'session_id']);
          if (kind === 'attempt' && id === server.rejectAttemptId) {
            rejected.push({ id, error_code: 'ID_CONFLICT', retryable: false });
            continue;
          }
          const store = kind === 'attempt' ? attempts : sessions;
          if (!store.has(id)) {
            const saved =
              kind === 'attempt'
                ? record
                : {
                    ...record,
                    source_kind: 'native',
                    source_record_id: null,
                    occurred_at: record.ended_at ?? record.started_at,
                    occurred_at_source: record.ended_at ? 'client_end' : 'client_start',
                    accuracy: record.mode === 'practice' ? record.accuracy : 1
                  };
            store.set(id, saved);
            changes.push({ revision: String(changes.length + 1), kind, record: saved });
          }
          acknowledged.push(id);
        }
        if (server.dropResponseFor === path) {
          server.dropResponseFor = '';
          throw new TypeError('Connection lost after commit');
        }
        return json({
          acknowledged_ids: acknowledged,
          [kind === 'attempt' ? 'rejected_events' : 'rejected_sessions']: rejected
        });
      }
      if (path.startsWith('/training/changes')) {
        const cursor = new URL(path, 'https://example.test').searchParams.get('cursor');
        const [after, capturedUpper] = cursor ? cursor.split(':').map(Number) : [0, changes.length];
        const upper = after === capturedUpper ? changes.length : capturedUpper;
        const rows = changes
          .filter((change) => Number(change.revision) > after && Number(change.revision) <= upper)
          .slice(0, 3);
        const last = rows.length ? Number(rows.at(-1)!.revision) : after;
        return json({ changes: rows, next_cursor: `${last}:${upper}`, has_more: last < upper });
      }
      throw new Error(`Unexpected API path ${path}`);
    }
  };
  return server;
}

const databases: IDBDatabase[] = [];
async function device(request: TrainingSyncPorts['request'], isCurrent = () => true) {
  const db = await openTrainingDb(new IDBFactory());
  databases.push(db);
  const repository = createTrainingSyncRepository(db, owner);
  return {
    db,
    repository,
    ports: { owner, clientId, repository, request, isCurrent } satisfies TrainingSyncPorts
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  databases.splice(0).forEach(closeTrainingDb);
});
async function saveGuided(db: IDBDatabase, id = 'guided', evidenceCount = 1) {
  const sessions = createSessionRepository(db, owner);
  await sessions.saveSession({ ...baseSession, id, promptCount: evidenceCount + 1 });
  const evidence = Array.from({ length: evidenceCount }, (_, index) => ({
    ...baseAttempt,
    id: `${id}-attempt-${index}`,
    sessionId: id,
    promptId: `${id}-prompt-${index}`
  }));
  await createAttemptRepository(db, owner).saveAttempts(evidence);
  await sessions.updateSessionProgress(id, evidenceCount + 1, 'completed', now);
  return evidence;
}
async function savePractice(db: IDBDatabase, id = 'practice') {
  await createSessionRepository(db, owner).saveSession({
    ...baseSession,
    id,
    mode: 'practice',
    status: 'completed',
    completedAt: now,
    promptCount: 1,
    completedPromptCount: 1,
    accuracy: 0.75
  });
}

describe('V1 training synchronization', () => {
  it('keeps a timed-out upload pending and retries its committed ID without duplicates', async () => {
    const server = memoryServer();
    const current = await device((path, init) => fetchApiResponse(path, init));
    await savePractice(current.db);
    const committed = new Promise<void>((resolve) => {
      vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
        await server.request(path, init);
        resolve();
        return new Promise<Response>(() => {});
      });
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const rejected = expect(synchronizeTraining(current.ports)).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT'
    });
    await committed;
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(await current.repository.countPending()).toBe(1);
    expect(await current.repository.getFailures()).toEqual([]);
    vi.stubGlobal('fetch', server.request);
    await synchronizeTraining(current.ports);
    expect(await current.repository.countPending()).toBe(0);
    expect(server.sessions.size).toBe(1);
    expect(await createSessionRepository(current.db, owner).getSessions()).toHaveLength(1);
    expect(await createSessionRepository(current.db, 'account:other').getSessions()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('restores both histories and guided mastery on a second independent device', async () => {
    const server = memoryServer();
    const first = await device(server.request);
    await saveGuided(first.db, 'lesson-a', 6);
    await saveGuided(first.db, 'lesson-b', 6);
    const beforePractice = reduceCharacterMastery(
      'K',
      await createAttemptRepository(first.db, owner).getAttemptsByCharacter('K'),
      { nowIso: now }
    );
    await savePractice(first.db);
    await synchronizeTraining(first.ports);
    const second = await device(server.request);
    await synchronizeTraining(second.ports);
    const attempts = await createAttemptRepository(second.db, owner).getAttemptsByCharacter('K');
    const restored = await createSessionRepository(second.db, owner).getSessions();
    expect(restored.map((record) => record.mode).sort()).toEqual(['guided', 'guided', 'practice']);
    expect(restored.find((record) => record.mode === 'practice')?.accuracy).toBe(0.75);
    expect(attempts).toHaveLength(12);
    expect(reduceCharacterMastery('K', attempts, { nowIso: now })).toEqual(beforePractice);
    expect(beforePractice.status).toBe('stable');
    expect(await first.repository.countPending()).toBe(0);
    expect(await second.repository.countPending()).toBe(0);
    const eventUpload = server.requests.find(
      (entry) => entry.path === '/training/events/batch'
    )!.body!;
    const sessionUpload = server.requests.find(
      (entry) => entry.path === '/training/sessions/batch'
    )!.body!;
    expect(eventUpload.schema_version).toBe(2);
    expect(sessionUpload.schema_version).toBe(1);
    expect(
      (sessionUpload.sessions as WireRecord[]).find((record) => record.mode === 'guided')
    ).toMatchObject({ prompt_count: 7, attempt_count: 6 });
    expect(
      server.requests.filter((entry) => entry.path.startsWith('/training/changes')).length
    ).toBeGreaterThan(2);
  });

  it.each(['/training/events/batch', '/training/sessions/batch'])(
    'retries a lost response from %s without duplicate records',
    async (lostPath) => {
      const server = memoryServer();
      server.dropResponseFor = lostPath;
      const current = await device(server.request);
      await saveGuided(current.db);
      await savePractice(current.db);
      await expect(synchronizeTraining(current.ports)).rejects.toThrow(
        'Connection lost after commit'
      );
      expect(await current.repository.countPending()).toBeGreaterThan(0);
      await synchronizeTraining(current.ports);
      expect(server.attempts.size).toBe(1);
      expect(server.sessions.size).toBe(2);
      expect(server.changes).toHaveLength(3);
      expect(await current.repository.countPending()).toBe(0);
    }
  );

  it('downloads a late offline record after a previously drained checkpoint', async () => {
    const server = memoryServer();
    const first = await device(server.request);
    const second = await device(server.request);
    await saveGuided(first.db);
    await synchronizeTraining(first.ports);
    await synchronizeTraining(second.ports);
    const previousCursor = await second.repository.getCursor();
    await createSessionRepository(first.db, owner).saveSession({
      ...baseSession,
      id: 'late-offline',
      mode: 'practice',
      status: 'completed',
      startedAt: '2026-09-01T00:00:00.000Z',
      completedAt: '2026-09-01T00:01:00.000Z',
      promptCount: 1,
      completedPromptCount: 1,
      accuracy: 0.5
    });
    await synchronizeTraining(first.ports);
    await synchronizeTraining(second.ports);
    expect(await second.repository.getCursor()).not.toBe(previousCursor);
    expect(
      await createSessionRepository(second.db, owner).getSession('late-offline')
    ).toMatchObject({ mode: 'practice', accuracy: 0.5 });
  });

  it('keeps the entire batch when a successful response omits a sibling acknowledgement', async () => {
    const current = await device(async () =>
      json({ acknowledged_ids: ['attempt'], rejected_events: [] })
    );
    await createAttemptRepository(current.db, owner).saveAttempts([
      baseAttempt,
      { ...baseAttempt, id: 'sibling' }
    ]);
    await expect(synchronizeTraining(current.ports)).rejects.toThrow(
      'Incomplete training acknowledgement'
    );
    expect(await current.repository.countPending()).toBe(2);
  });

  it('holds a rejected attempt and its frozen manifest while uploading unrelated sessions', async () => {
    const server = memoryServer();
    server.rejectAttemptId = 'bad-attempt-0';
    const current = await device(server.request);
    await saveGuided(current.db, 'bad');
    await saveGuided(current.db, 'good');
    await savePractice(current.db);
    await synchronizeTraining(current.ports);
    expect(server.sessions.has('bad')).toBe(false);
    expect(server.sessions.has('good')).toBe(true);
    expect(server.sessions.has('practice')).toBe(true);
    expect((await current.repository.getFailures()).map((record) => record.id).sort()).toEqual([
      'bad',
      'bad-attempt-0'
    ]);
    expect(await current.repository.countPending()).toBe(2);
    expect(await current.repository.getPending()).toEqual([]);
  });

  it('skips a session whose attempt is temporarily rejected and continues unrelated practice', async () => {
    const current = await device(async (path) => {
      if (path === '/training/events/batch')
        return json({
          acknowledged_ids: [],
          rejected_events: [{ id: 'guided-attempt-0', error_code: 'TRY_AGAIN', retryable: true }]
        });
      if (path === '/training/sessions/batch')
        return json({ acknowledged_ids: ['practice'], rejected_sessions: [] });
      return json(emptyPage());
    });
    await saveGuided(current.db);
    await savePractice(current.db);
    await expect(synchronizeTraining(current.ports)).rejects.toMatchObject({
      code: 'TRAINING_SYNC_PENDING'
    });
    expect((await current.repository.getPending('session')).map((record) => record.id)).toEqual([
      'guided'
    ]);
    expect(await current.repository.getFailures()).toEqual([]);
  });

  it('does not acknowledge or download after ownership changes while a response body is pending', async () => {
    let active = true;
    const current = await device(
      async (path) => {
        if (path === '/training/events/batch')
          return {
            ok: true,
            json: async () => {
              active = false;
              return { acknowledged_ids: ['guided-attempt-0'], rejected_events: [] };
            }
          } as Response;
        throw new Error('A switched account must make no follow-up request');
      },
      () => active
    );
    await saveGuided(current.db);
    await expect(synchronizeTraining(current.ports)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await current.repository.countPending()).toBe(2);
    expect(await current.repository.getCursor()).toBeNull();
  });

  it('does not commit malformed feed contents or its checkpoint', async () => {
    const current = await device(async () =>
      json({
        changes: [
          { revision: '1', kind: 'attempt', record: attemptToWire(baseAttempt) },
          { revision: '2', kind: 'session', record: {} }
        ],
        next_cursor: 'bad',
        has_more: false
      })
    );
    await expect(synchronizeTraining(current.ports)).rejects.toThrow('Invalid training');
    expect(await current.repository.getCursor()).toBeNull();
    expect(await createAttemptRepository(current.db, owner).countAttempts()).toBe(0);
  });

  it('does not commit a download whose owner changes while its response body is pending', async () => {
    let active = true;
    const current = await device(
      async () =>
        ({
          ok: true,
          json: async () => {
            active = false;
            return {
              changes: [{ revision: '1', kind: 'attempt', record: attemptToWire(baseAttempt) }],
              next_cursor: 'wrong-owner',
              has_more: false
            };
          }
        }) as Response,
      () => active
    );
    await expect(synchronizeTraining(current.ports)).rejects.toMatchObject({ name: 'AbortError' });
    expect(await current.repository.getCursor()).toBeNull();
    expect(await createAttemptRepository(current.db, owner).countAttempts()).toBe(0);
  });

  it('rebootstraps a retired cursor while preserving rejected pending work', async () => {
    let resetSeen = false;
    const current = await device(async (path) => {
      if (path === '/training/events/batch')
        return json({
          acknowledged_ids: [],
          rejected_events: [{ id: 'attempt', error_code: 'ID_CONFLICT', retryable: false }]
        });
      if (path.includes('cursor=retired')) {
        resetSeen = true;
        return json({ code: 'TRAINING_CURSOR_RESET_REQUIRED' }, 410);
      }
      expect(path).toBe('/training/changes');
      return json({
        changes: [
          {
            revision: '1',
            kind: 'attempt',
            record: { ...attemptToWire(baseAttempt), entered_text: 'server-original' }
          }
        ],
        next_cursor: 'new-epoch',
        has_more: false
      });
    });
    await current.repository.applyDownloadPage({
      attempts: [],
      sessions: [],
      expectedCursor: null,
      nextCursor: 'retired'
    });
    await createAttemptRepository(current.db, owner).saveAttempt(baseAttempt);
    await synchronizeTraining(current.ports);
    expect(resetSeen).toBe(true);
    expect(await current.repository.getCursor()).toBe('new-epoch');
    expect(await current.repository.countPending()).toBe(1);
    expect(
      (await createAttemptRepository(current.db, owner).getAttempt('attempt'))?.enteredText
    ).toBe('K');
  });

  it.each([503, 429])(
    'retains pending uploads and honors Retry-After for HTTP %i',
    async (status) => {
      const current = await device(async () =>
        json({ code: status === 503 ? 'TRAINING_SYNC_INITIALIZING' : 'RATE_LIMITED' }, status, {
          'Retry-After': '7'
        })
      );
      await createAttemptRepository(current.db, owner).saveAttempt(baseAttempt);
      await expect(synchronizeTraining(current.ports)).rejects.toMatchObject({
        retryAfterMs: 7000,
        permanent: false
      });
      expect(await current.repository.countPending()).toBe(1);
      expect(await current.repository.getFailures()).toEqual([]);
    }
  );

  it('classifies non-JSON transient HTTP errors while keeping queued work', async () => {
    const current = await device(
      async () =>
        new Response('<html>Unavailable</html>', { status: 503, headers: { 'Retry-After': '5' } })
    );
    await createAttemptRepository(current.db, owner).saveAttempt(baseAttempt);
    await expect(synchronizeTraining(current.ports)).rejects.toBeInstanceOf(TrainingSyncError);
    expect(await current.repository.countPending()).toBe(1);
  });
});

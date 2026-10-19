import type {
  TrainingSyncRepository,
  FrozenOutboxRecord,
  RecordKind
} from './data/training-sync-repository';
import type { AttemptEvent, TrainingSessionRecord } from './training/v2/types';
import { attemptToWire, parseChangePage, sessionToWire } from './training-wire';

export class TrainingSyncError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs = 0,
    readonly permanent = false
  ) {
    super(code);
  }
}

export interface TrainingSyncPorts {
  owner: string;
  clientId: string;
  repository: TrainingSyncRepository;
  isCurrent(): boolean;
  request(path: string, init?: RequestInit): Promise<Response>;
}

function assertCurrent(ports: TrainingSyncPorts) {
  if (!ports.isCurrent()) throw new DOMException('Training owner changed', 'AbortError');
}

async function jsonResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const code =
    body && typeof body === 'object' && 'code' in body ? String(body.code) : 'TRAINING_SYNC_FAILED';
  const header = response.headers.get('Retry-After');
  const seconds = Number(header);
  const parsedRetry = header
    ? Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Math.max(0, Date.parse(header) - Date.now())
    : 0;
  const retryAfterMs = Number.isFinite(parsedRetry) ? parsedRetry : 0;
  throw new TrainingSyncError(
    code,
    retryAfterMs,
    response.status >= 400 && response.status < 500 && ![401, 410, 429].includes(response.status)
  );
}

/** Each response is fenced before its acknowledgement or cursor can mutate storage. */
export async function synchronizeTraining(ports: TrainingSyncPorts): Promise<void> {
  const { repository: repo } = ports;
  let deferred = false;
  for (const kind of ['attempt', 'session'] as const) {
    // Excluding attempted IDs prevents one retryable rejection from starving siblings.
    const attempted = new Set<string>();
    while (true) {
      assertCurrent(ports);
      const pending = (await repo.getPending(kind, Number.MAX_SAFE_INTEGER)).filter(
        (r) => !attempted.has(r.id)
      );
      assertCurrent(ports);
      if (!pending.length) break;
      const selected: FrozenOutboxRecord[] = [];
      for (const record of pending) {
        if (record.ownerKey !== ports.owner) throw new Error('Training outbox ownership mismatch');
        if (kind === 'session') {
          const dependency = await repo.getSessionDependencies(record);
          assertCurrent(ports);
          if (dependency.permanentError) {
            await repo.reject(record, dependency.permanentError, true);
            attempted.add(record.id);
            continue;
          }
          if (dependency.pending) {
            attempted.add(record.id);
            deferred = true;
            continue;
          }
        }
        selected.push(record);
        if (selected.length === (kind === 'attempt' ? 100 : 20)) break;
      }
      if (!selected.length) continue;
      const batch: FrozenOutboxRecord[] = [];
      for (const record of selected) {
        const candidate = [...batch, record];
        if (
          new TextEncoder().encode(JSON.stringify(envelope(kind, candidate, ports.clientId)))
            .length >
          256 * 1024
        ) {
          if (!batch.length) {
            await repo.reject(record, 'TRAINING_PAYLOAD_TOO_LARGE', true);
            attempted.add(record.id);
          }
          break;
        }
        batch.push(record);
      }
      if (!batch.length) continue;
      assertCurrent(ports);
      let body: unknown;
      try {
        body = await jsonResponse(
          await ports.request(`/training/${kind === 'attempt' ? 'events' : 'sessions'}/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envelope(kind, batch, ports.clientId))
          })
        );
      } catch (error) {
        assertCurrent(ports);
        if (error instanceof TrainingSyncError && error.permanent) {
          for (const record of batch) await repo.reject(record, error.code, true);
          continue;
        }
        throw error;
      }
      assertCurrent(ports);
      const result = body as {
        acknowledged_ids?: unknown;
        rejected_events?: unknown;
        rejected_sessions?: unknown;
      };
      const rejected = kind === 'attempt' ? result.rejected_events : result.rejected_sessions;
      if (!Array.isArray(result.acknowledged_ids) || !Array.isArray(rejected))
        throw new Error('Invalid training acknowledgement');
      const acknowledgements = new Set(result.acknowledged_ids);
      const accepted: FrozenOutboxRecord[] = [];
      for (const record of batch) {
        assertCurrent(ports);
        attempted.add(record.id);
        if (acknowledgements.has(record.id)) accepted.push(record);
        else {
          const rejection = rejected.find(
            (entry: unknown) =>
              entry && typeof entry === 'object' && 'id' in entry && entry.id === record.id
          ) as { error_code?: unknown; retryable?: unknown } | undefined;
          if (!rejection || typeof rejection.error_code !== 'string')
            throw new Error('Incomplete training acknowledgement');
          const retryable =
            rejection.retryable === true || rejection.error_code === 'MISSING_SESSION_EVENTS';
          await repo.reject(record, rejection.error_code, !retryable);
          deferred ||= retryable;
        }
      }
      assertCurrent(ports);
      if (accepted.length) await repo.acknowledge(accepted);
    }
  }
  let reset = false;
  for (;;) {
    assertCurrent(ports);
    const expectedCursor = await repo.getCursor();
    assertCurrent(ports);
    let raw: unknown;
    try {
      raw = await jsonResponse(
        await ports.request(
          `/training/changes${expectedCursor ? `?cursor=${encodeURIComponent(expectedCursor)}` : ''}`
        )
      );
    } catch (error) {
      assertCurrent(ports);
      if (
        !reset &&
        error instanceof TrainingSyncError &&
        error.code === 'TRAINING_CURSOR_RESET_REQUIRED'
      ) {
        await repo.resetCursor();
        reset = true;
        continue;
      }
      throw error;
    }
    assertCurrent(ports);
    const page = parseChangePage(raw);
    await repo.applyDownloadPage({ ...page, expectedCursor });
    assertCurrent(ports);
    if (!page.hasMore) break;
  }
  if (deferred) throw new TrainingSyncError('TRAINING_SYNC_PENDING');
}

function envelope(kind: RecordKind, records: FrozenOutboxRecord[], clientId: string) {
  return {
    schema_version: kind === 'attempt' ? 2 : 1,
    client_id: clientId,
    ...(kind === 'attempt'
      ? { events: records.map((r) => attemptToWire(r.payload as AttemptEvent)) }
      : { sessions: records.map((r) => sessionToWire(r.payload as TrainingSessionRecord)) })
  };
}

import {
  isEvidenceRecord,
  type EvidenceChange,
  type EvidenceRecord,
  type LearningEvidenceRepository
} from '../data/learning-evidence';
export class EvidenceSyncError extends Error {
  constructor(
    readonly code: string,
    readonly unavailable = false,
    readonly retryAfterMs = 0
  ) {
    super(code);
  }
}
export interface EvidenceSyncPorts {
  repository: LearningEvidenceRepository;
  isCurrent(): boolean;
  request(path: string, init?: RequestInit): Promise<Response>;
}
const current = (p: EvidenceSyncPorts) => {
  if (!p.isCurrent()) throw new DOMException('Evidence owner changed', 'AbortError');
};
async function responseBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const code =
    body && typeof body === 'object' && 'code' in body ? String(body.code) : 'LEARNING_SYNC_FAILED';
  const retry = Number(response.headers.get('Retry-After')) * 1000;
  throw new EvidenceSyncError(
    code,
    response.status === 404 || response.status === 501 || code.includes('UNSUPPORTED_SCHEMA'),
    Number.isFinite(retry) ? Math.max(0, retry) : 0
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export async function synchronizeLearningEvidence(ports: EvidenceSyncPorts): Promise<void> {
  const repo = ports.repository;
  current(ports);
  const clientId = await repo.clientId();
  current(ports);
  const attempted = new Set<string>();
  let deferred = false;
  while (true) {
    current(ports);
    const pending = (await repo.pending()).filter((r) => !attempted.has(r.id));
    current(ports);
    if (!pending.length) break;
    const batch: EvidenceRecord[] = [];
    const envelope = () => ({ schema_version: 1, client_id: clientId, records: batch });
    for (const record of pending.slice(0, 100)) {
      batch.push(record);
      if (new TextEncoder().encode(JSON.stringify(envelope())).length > 256 * 1024) {
        batch.pop();
        if (!batch.length) {
          await repo.reject(record.id, 'EVIDENCE_TOO_LARGE', true);
          attempted.add(record.id);
        }
        break;
      }
    }
    if (!batch.length) continue;
    const body = await responseBody(
      await ports.request('/training/learning-evidence/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope())
      })
    );
    current(ports);
    if (
      !object(body) ||
      !Array.isArray(body.acknowledged_ids) ||
      !Array.isArray(body.rejected_records)
    )
      throw new EvidenceSyncError('INVALID_EVIDENCE_ACK');
    const accepted: string[] = [];
    for (const record of batch) {
      attempted.add(record.id);
      if (body.acknowledged_ids.includes(record.id)) accepted.push(record.id);
      else {
        const reject = body.rejected_records.find((r) => object(r) && r.id === record.id);
        if (
          !object(reject) ||
          typeof reject.error_code !== 'string' ||
          typeof reject.retryable !== 'boolean'
        )
          throw new EvidenceSyncError('INCOMPLETE_EVIDENCE_ACK');
        if (reject.error_code === 'FEATURE_NOT_ENABLED')
          throw new EvidenceSyncError(reject.error_code, true);
        current(ports);
        await repo.reject(record.id, reject.error_code, !reject.retryable);
        deferred ||= reject.retryable;
      }
    }
    current(ports);
    await repo.acknowledge(accepted);
  }
  let reset = false;
  for (;;) {
    current(ports);
    const cursor = await repo.getCursor();
    current(ports);
    let body: unknown;
    try {
      body = await responseBody(
        await ports.request(
          `/training/learning-evidence/changes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        )
      );
    } catch (error) {
      current(ports);
      if (
        error instanceof EvidenceSyncError &&
        error.code === 'LEARNING_EVIDENCE_CURSOR_RESET_REQUIRED' &&
        !reset
      ) {
        await repo.resetCursor(cursor);
        reset = true;
        continue;
      }
      throw error;
    }
    current(ports);
    if (
      !object(body) ||
      !Array.isArray(body.changes) ||
      typeof body.next_cursor !== 'string' ||
      !body.next_cursor ||
      typeof body.has_more !== 'boolean'
    )
      throw new EvidenceSyncError('INVALID_EVIDENCE_PAGE');
    const changes: EvidenceChange[] = [];
    let last = 0n;
    for (const item of body.changes) {
      if (
        !object(item) ||
        typeof item.revision !== 'string' ||
        !/^\d+$/.test(item.revision) ||
        BigInt(item.revision) <= last ||
        !isEvidenceRecord(item.record) ||
        item.kind !== item.record.kind
      )
        throw new EvidenceSyncError('INVALID_EVIDENCE_CHANGE');
      last = BigInt(item.revision);
      changes.push({ revision: item.revision, kind: item.record.kind, record: item.record });
    }
    if (body.has_more && (!changes.length || body.next_cursor === cursor))
      throw new EvidenceSyncError('STALLED_EVIDENCE_CURSOR');
    current(ports);
    await repo.applyPage(changes, body.next_cursor, cursor);
    if (!body.has_more) break;
  }
  if (deferred) throw new EvidenceSyncError('MISSING_EVIDENCE_DEPENDENCY');
}

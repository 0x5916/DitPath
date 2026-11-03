import {
  captureProcessId,
  createLearningEvidenceRepository,
  markCaptureCleanShutdown,
  openLearningEvidenceDb,
  previousCaptureProcessId,
  previousCaptureWasClean,
  type EvidenceRecord,
  type LearningEvidenceRepository
} from '../data/learning-evidence';

/** A live document refreshes its presence before this lease expires. */
export const CAPTURE_LEASE_MS = 20_000;
export const CAPTURE_HEARTBEAT_MS = 5_000;
/**
 * Without Web Locks another tab's liveness cannot be observed directly. A
 * record from a process without a presence lease is still only recoverable
 * after this conservative delay, so a delayed write or a slow start is not
 * mistaken for an abandoned one.
 */
export const LOCKLESS_RECOVERY_GRACE_MS = 60_000;
const PRESENCE_PREFIX = 'opencw:learning-evidence-presence:';

function presenceStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
/** Advisory only: this lease never proves exposure or completion. */
export function touchCapturePresence(process = captureProcessId(), now = Date.now()): void {
  try {
    presenceStore()?.setItem(PRESENCE_PREFIX + process, String(now + CAPTURE_LEASE_MS));
  } catch {
    /* Storage may be unavailable or full; recovery stays conservative. */
  }
}
export function releaseCapturePresence(process = captureProcessId()): void {
  try {
    presenceStore()?.removeItem(PRESENCE_PREFIX + process);
  } catch {
    /* Nothing to release. */
  }
}
export function capturePresenceState(
  process: string,
  now = Date.now()
): 'unsupported' | 'alive' | 'dead' {
  const store = presenceStore();
  if (!store) return 'unsupported';
  const raw = store.getItem(PRESENCE_PREFIX + process);
  if (raw === null) return 'dead';
  const expires = Number(raw);
  return Number.isFinite(expires) && expires >= now ? 'alive' : 'dead';
}
/** Milliseconds since a recorded lease expired; null when absent or alive. */
export function capturePresenceExpiredMs(process: string, now = Date.now()): number | null {
  const store = presenceStore();
  if (!store) return null;
  const raw = store.getItem(PRESENCE_PREFIX + process);
  if (raw === null) return null;
  const expires = Number(raw);
  return Number.isFinite(expires) && expires < now ? now - expires : null;
}

/** A live document holds its lease; a second tab cannot close its active tones. */
export function retainCaptureLease(): () => void {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  let release = () => {};
  let disposed = false;
  if (locks) {
    void locks.request(`opencw-capture:${captureProcessId()}`, async () => {
      if (disposed) return;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    return () => {
      disposed = true;
      release();
    };
  }
  // Without Web Locks, persist a bounded process presence instead. It lets a
  // recovering document distinguish a live sibling tab from a crashed one
  // without closing exposure based on a missing lock alone.
  const process = captureProcessId();
  touchCapturePresence(process);
  const timer = setInterval(() => touchCapturePresence(process), CAPTURE_HEARTBEAT_MS);
  const stopPresence = () => releaseCapturePresence(process);
  const onPageHide = (event: Event) => {
    // A BFCache suspension can resume; only a real unload is a clean shutdown.
    if ((event as PageTransitionEvent).persisted !== true) markCaptureCleanShutdown(process);
    stopPresence();
  };
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted === true) touchCapturePresence(process);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
  }
  return () => {
    disposed = true;
    clearInterval(timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    }
    stopPresence();
  };
}

interface RecoveryCandidate {
  record: EvidenceRecord;
  processId: string;
}
async function appendRecovered(
  repo: LearningEvidenceRepository,
  record: EvidenceRecord
): Promise<void> {
  try {
    await repo.append([record]);
  } catch (error) {
    // A concurrent safe recovery may have produced the same immutable record.
    const all = await repo.all();
    if (!all.some((entry) => entry.id === record.id)) throw error;
  }
}
async function recoverCandidate(
  repo: LearningEvidenceRepository,
  candidate: RecoveryCandidate,
  isCurrent: () => boolean,
  now: string
): Promise<void> {
  const records = await repo.all();
  if (candidate.record.kind === 'plan') {
    if (await repo.getCheckpoint(String(candidate.record.session_id))) return;
    if (
      records.some((r) => r.kind === 'terminal' && r.session_id === candidate.record.session_id) ||
      !isCurrent()
    )
      return;
    await appendRecovered(repo, {
      id: `end_${candidate.record.session_id}`,
      kind: 'terminal',
      policy_version: 'learning-policy-1.0',
      recorded_at: now,
      session_id: candidate.record.session_id,
      status: 'abandoned',
      ended_at: now,
      observation_ids: records
        .filter((r) => r.kind === 'observation' && r.session_id === candidate.record.session_id)
        .map((r) => r.id)
        .sort()
    });
    return;
  }
  // Recheck under the lease: another recovery may have finished while we waited.
  if (records.some((r) => r.kind === 'exposure-close' && r.open_id === candidate.record.id)) return;
  if (!isCurrent()) return;
  await appendRecovered(repo, {
    id: `close_${candidate.record.id}`,
    kind: 'exposure-close',
    policy_version: 'learning-policy-1.0',
    recorded_at: now,
    open_id: candidate.record.id,
    end_reason: 'recovery',
    last_exposure: Object.fromEntries(
      (candidate.record.characters as string[]).map((ch) => [
        ch,
        { earliest: now, latest: now, source: 'wall-clock-bounded' }
      ])
    )
  });
}

/** `now` and presence are injectable so recovery can be tested deterministically. */
export async function recoverInterruptedEvidence(
  owner: string,
  isCurrent: () => boolean,
  options: { now?: () => number } = {}
): Promise<void> {
  const clock = options.now ?? Date.now;
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  const db = await openLearningEvidenceDb();
  try {
    const repo = createLearningEvidenceRepository(db, owner);
    const candidates = await repo.orphanCandidates();
    for (const candidate of candidates) {
      if (!isCurrent()) return;
      if (locks) {
        await locks.request(
          `opencw-capture:${candidate.processId}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock || !isCurrent()) return;
            await recoverCandidate(repo, candidate, isCurrent, new Date(clock()).toISOString());
          }
        );
        continue;
      }
      const now = clock();
      const previous = previousCaptureProcessId();
      // A clean same-tab unload writes a process-scoped marker. Session storage
      // can be copied into a cloned tab, but the clone cannot inherit a marker
      // for its own newly generated process id. Without that marker, require a
      // dead presence lease and a conservative record age, even for the
      // predecessor: copied identity alone is never proof of death.
      if (candidate.processId !== previous || !previousCaptureWasClean(candidate.processId)) {
        const presence = capturePresenceState(candidate.processId, now);
        if (presence !== 'dead') continue;
        // A lease that expired a moment ago may still belong to a throttled
        // live tab. Wait the full grace after expiry; when no lease was ever
        // recorded, fall back to the record age so a slow first write is not
        // mistaken for abandonment.
        const expiredFor = capturePresenceExpiredMs(candidate.processId, now);
        if (expiredFor !== null) {
          if (expiredFor < LOCKLESS_RECOVERY_GRACE_MS) continue;
        } else {
          const recorded = Date.parse(candidate.record.recorded_at);
          if (
            !Number.isFinite(recorded) ||
            recorded > now + CAPTURE_LEASE_MS ||
            now - recorded < LOCKLESS_RECOVERY_GRACE_MS
          )
            continue;
        }
      }
      await recoverCandidate(repo, candidate, isCurrent, new Date(now).toISOString());
    }
  } finally {
    db.close();
  }
}

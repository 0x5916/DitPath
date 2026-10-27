import {
  captureProcessId,
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord
} from '../data/learning-evidence';
/** A live document holds its lease; a second tab cannot close its active tones. */
export function retainCaptureLease(): () => void {
  if (typeof navigator === 'undefined' || !navigator.locks) return () => {};
  let release = () => {};
  let disposed = false;
  void navigator.locks.request(`opencw-capture:${captureProcessId()}`, async () => {
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
export async function recoverInterruptedEvidence(
  owner: string,
  isCurrent: () => boolean
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) return;
  const db = await openLearningEvidenceDb();
  try {
    const repo = createLearningEvidenceRepository(db, owner);
    for (const candidate of await repo.orphanCandidates()) {
      if (!isCurrent()) return;
      await navigator.locks.request(
        `opencw-capture:${candidate.processId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock || !isCurrent()) return;
          const all = await repo.all();
          if (candidate.record.kind === 'plan') {
            if (await repo.getCheckpoint(String(candidate.record.session_id))) return;
            if (
              all.some(
                (r) => r.kind === 'terminal' && r.session_id === candidate.record.session_id
              ) ||
              !isCurrent()
            )
              return;
            const now = new Date().toISOString();
            await repo.append([
              {
                id: `end_${candidate.record.session_id}`,
                kind: 'terminal',
                policy_version: 'learning-policy-1.0',
                recorded_at: now,
                session_id: candidate.record.session_id,
                status: 'abandoned',
                ended_at: now,
                observation_ids: all
                  .filter(
                    (r) => r.kind === 'observation' && r.session_id === candidate.record.session_id
                  )
                  .map((r) => r.id)
                  .sort()
              }
            ]);
            return;
          }
          // Recheck under the lease: another recovery may have finished while we waited.
          if (all.some((r) => r.kind === 'exposure-close' && r.open_id === candidate.record.id))
            return;
          if (!isCurrent()) return;
          const now = new Date().toISOString();
          const record: EvidenceRecord = {
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
          };
          await repo.append([record]);
        }
      );
    }
  } finally {
    db.close();
  }
}

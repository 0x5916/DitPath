import { openLearningEvidenceDb, createLearningEvidenceRepository } from './learning-evidence';
import { openTrainingDb } from './training-db';
import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import { createEvidenceSessionRepositories, type LearningSessionPlan } from './evidence-session';
import { createEvidenceAudioEngine, type EvidencePresentation } from '../audio/evidence-engine';
import type { GuidedSessionState } from '../training/v2/guided-session';
import type { TrainingSessionRecord } from '../training/v2/types';
import type { ReviewPlan } from '../training/targeted-review';
import type { MixedCheckSession } from '../training/learning-policy/mixed-plan';
import type { CopyAttempt } from '../practice/copy-attempt';
export interface GuidedCheckpoint {
  version: 1;
  kind: 'guided';
  id: string;
  href: string;
  savedAt: string;
  draft: string;
  state: GuidedSessionState;
  record: TrainingSessionRecord;
  review: ReviewPlan | null;
  mixed: MixedCheckSession | null;
  first: EvidencePresentation | null;
}
export interface CopyCheckpoint {
  version: 1;
  kind: 'copy';
  id: 'copy';
  href: '/morse/practice';
  savedAt: string;
  draft: string;
  attempt: CopyAttempt;
}
export type SessionCheckpoint = GuidedCheckpoint | CopyCheckpoint;
export function validCheckpoint(value: unknown): value is SessionCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const c = value as SessionCheckpoint;
  if (
    c.version !== 1 ||
    typeof c.id !== 'string' ||
    typeof c.href !== 'string' ||
    typeof c.draft !== 'string' ||
    !Number.isFinite(Date.parse(c.savedAt))
  )
    return false;
  if (c.kind === 'copy')
    return (
      c.id === 'copy' &&
      c.href === '/morse/practice' &&
      typeof c.attempt?.exercise?.text === 'string' &&
      c.attempt.exercise.text.length <= 10000 &&
      !!c.attempt.settings &&
      !!c.attempt.session
    );
  return (
    c.kind === 'guided' &&
    c.href.startsWith('/morse/learn/session?') &&
    c.record?.id === c.id &&
    c.record.status === 'in-progress' &&
    c.state?.sessionId === c.id &&
    Array.isArray(c.state.prompts) &&
    c.state.prompts.length > 0 &&
    c.state.prompts.length <= 1000 &&
    c.state.currentPromptIndex >= 0 &&
    c.state.currentPromptIndex < c.state.prompts.length &&
    Array.isArray(c.state.attempts) &&
    c.state.attempts.every(
      (a) => a.sessionId === c.id && c.state.prompts.some((p) => p.id === a.promptId)
    ) &&
    c.state.currentPrompt?.id === c.state.prompts[c.state.currentPromptIndex]?.id &&
    ['idle', 'ready', 'playing', 'answering', 'introducing', 'paused', 'feedback'].includes(
      c.state.phase
    ) &&
    !['complete', 'abandoned'].includes(c.state.phase)
  );
}
async function repository<T>(
  owner: string,
  fn: (repo: ReturnType<typeof createLearningEvidenceRepository>) => Promise<T>
): Promise<T> {
  const db = await openLearningEvidenceDb();
  try {
    return await fn(createLearningEvidenceRepository(db, owner));
  } finally {
    db.close();
  }
}
export const listCheckpoints = (owner: string) =>
  repository(owner, async (r) =>
    (await r.checkpoints())
      .filter(validCheckpoint)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  );
export const loadCheckpoint = (owner: string, id: string) =>
  repository(owner, async (r) => {
    const c = await r.getCheckpoint(id);
    return validCheckpoint(c) && c.id === id ? c : null;
  });
export const saveCheckpoint = (owner: string, c: SessionCheckpoint) =>
  repository(owner, async (r) => {
    if (!validCheckpoint(c)) throw Error('Invalid session checkpoint');
    await r.setCheckpoint(c.id, c);
  });
export const removeCheckpoint = (owner: string, id: string) =>
  repository(owner, (r) => r.setCheckpoint(id, null));
/** Hold the same-session lock for the lifetime of a fresh or continued session. */
export async function claimSession(
  owner: string,
  id: string,
  resuming = false
): Promise<() => Promise<void>> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    if (resuming) throw Error('Session locking unavailable');
    return async () => {};
  }
  return new Promise((resolve, reject) => {
    const finished = navigator.locks
      .request(`opencw-session:${owner}:${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(Error('Session is active in another tab'));
          return;
        }
        await new Promise<void>((release) =>
          resolve(async () => {
            release();
            await finished;
          })
        );
      })
      .catch(reject);
  });
}
export function checkpointMetadata(c: GuidedCheckpoint): LearningSessionPlan {
  const plan = c.mixed?.plan;
  return {
    purpose: plan
      ? 'mixed-check'
      : c.review?.purpose === 'return-screening'
        ? 'screening'
        : 'coaching',
    targets: plan?.targets ?? c.review!.targets,
    knownCharacters: plan?.introducedCharacters ?? c.review!.knownCharacters,
    prompts: c.state.prompts,
    profile: plan?.profile ?? {
      id: `single-character-clean-open-${c.record.charWpm}`,
      task: 'single-character',
      charWpm: c.record.charWpm,
      audioCondition: 'clean',
      responseSupport: 'open'
    },
    reviewCycleIds: plan?.reviewCycleIds
  };
}
export async function discardCheckpoint(owner: string, c: SessionCheckpoint) {
  const release = await claimSession(owner, c.id, true);
  try {
    if (c.kind === 'guided') {
      if (c.review || c.mixed) {
        const db = await openLearningEvidenceDb();
        const audio = createEvidenceAudioEngine({ ownerKey: owner, source: 'reference' });
        try {
          const repo = createLearningEvidenceRepository(db, owner);
          const adapted = createEvidenceSessionRepositories(
            repo,
            owner,
            checkpointMetadata(c),
            audio,
            {
              session: c.record,
              records: await repo.all(),
              attempts: c.state.attempts,
              first: c.first
                ? { promptId: c.state.currentPrompt!.id, presentation: c.first }
                : undefined
            }
          );
          await adapted.attemptRepo.saveAttempts(c.state.attempts);
          await adapted.sessionRepo.updateSessionProgress(
            c.id,
            c.record.completedPromptCount,
            'abandoned',
            new Date().toISOString()
          );
        } finally {
          await audio.dispose();
          db.close();
        }
      } else {
        const db = await openTrainingDb();
        try {
          const sessions = createSessionRepository(db, owner);
          const record = await sessions.getSession(c.id);
          if (record?.status === 'in-progress') {
            await createAttemptRepository(db, owner).saveAttempts(c.state.attempts);
            await sessions.updateSessionProgress(
              c.id,
              c.record.completedPromptCount,
              'abandoned',
              new Date().toISOString()
            );
          }
        } finally {
          db.close();
        }
      }
    }
    await removeCheckpoint(owner, c.id);
  } finally {
    await release();
  }
}

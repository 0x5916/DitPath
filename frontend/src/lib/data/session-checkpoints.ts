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

const COPY_STATUSES: readonly string[] = [
  'ready',
  'playing',
  'paused',
  'awaiting-check',
  'reviewed',
  'disposed'
];
const GUIDED_PHASES: readonly string[] = [
  'idle',
  'ready',
  'playing',
  'answering',
  'introducing',
  'paused',
  'feedback'
];

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Reject a structurally corrupt copy attempt before it reaches the editor. */
function validCopyAttempt(attempt: CopyAttempt | undefined): boolean {
  if (!attempt || typeof attempt !== 'object') return false;
  const settings = attempt.settings;
  const session = attempt.session;
  return (
    typeof attempt.id === 'string' &&
    attempt.id.length > 0 &&
    !!attempt.exercise &&
    typeof attempt.exercise === 'object' &&
    finite(attempt.exercise.lesson) &&
    typeof attempt.exercise.text === 'string' &&
    attempt.exercise.text.length <= 10000 &&
    !!settings &&
    typeof settings === 'object' &&
    finite(settings.charWpm) &&
    finite(settings.effWpm) &&
    finite(settings.freq) &&
    finite(settings.volume) &&
    finite(settings.startDelay) &&
    !!session &&
    typeof session === 'object' &&
    COPY_STATUSES.includes(session.status) &&
    finite(session.attempt) &&
    session.attempt >= 1 &&
    (session.recordedAttempt === null ||
      (finite(session.recordedAttempt) && session.recordedAttempt >= 0))
  );
}

/** Validate nested guided state without throwing on null/corrupt array entries. */
function validGuidedState(state: GuidedSessionState, id: string): boolean {
  if (!state || typeof state !== 'object') return false;
  const prompts = state.prompts;
  const attempts = state.attempts;
  if (
    !Array.isArray(prompts) ||
    prompts.length === 0 ||
    prompts.length > 1000 ||
    !prompts.every(
      (prompt) => prompt && typeof prompt === 'object' && typeof prompt.id === 'string'
    )
  )
    return false;
  if (
    !Array.isArray(attempts) ||
    !attempts.every(
      (attempt) =>
        attempt &&
        typeof attempt === 'object' &&
        attempt.sessionId === id &&
        prompts.some((prompt) => prompt.id === attempt.promptId)
    )
  )
    return false;
  const index = state.currentPromptIndex;
  return (
    state.sessionId === id &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < prompts.length &&
    state.currentPrompt?.id === prompts[index]?.id &&
    GUIDED_PHASES.includes(state.phase)
  );
}

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
    return c.id === 'copy' && c.href === '/morse/practice' && validCopyAttempt(c.attempt);
  return (
    c.kind === 'guided' &&
    c.href.startsWith('/morse/learn/session?') &&
    c.record?.id === c.id &&
    c.record.status === 'in-progress' &&
    validGuidedState(c.state, c.id) &&
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

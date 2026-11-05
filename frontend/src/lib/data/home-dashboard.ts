import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import { deriveCourseGuidance } from '../training/v2/course-guidance';
import { summarizeProgress } from '../training/v2/progress-summary';
import { recordedCharacters, returningLearner } from '../training/targeted-review';

/** Lifetime eligibility stays separate from the rolling learning/activity summaries. */
export async function loadHomeDashboard(db: IDBDatabase, owner: string, nowIso: string) {
  const attempts = createAttemptRepository(db, owner);
  const sessions = createSessionRepository(db, owner);
  const now = Date.parse(nowIso);
  const [allAttempts, history, unfinishedSession] = await Promise.all([
    attempts.getAttemptsByTimeRange('0001-01-01T00:00:00.000Z', nowIso),
    sessions.getSessions(),
    sessions.getLatestInProgressSession()
  ]);
  const recentStart = new Date(now - 60 * 86400000).toISOString();
  const recentAttempts = allAttempts.filter((attempt) => attempt.createdAt >= recentStart);
  const knownCharacters = recordedCharacters(allAttempts);
  return {
    knownCharacters,
    returning: returningLearner(history, knownCharacters, nowIso),
    hasActivity:
      allAttempts.length > 0 ||
      history.some(
        (session) => (session.completedPromptCount ?? 0) > 0 || session.status === 'completed'
      ),
    guidance: deriveCourseGuidance(recentAttempts, nowIso, undefined, {
      history: allAttempts
    }),
    unfinishedSession,
    summary: summarizeProgress(allAttempts, history, nowIso)
  };
}

export type HomeDashboard = Awaited<ReturnType<typeof loadHomeDashboard>>;

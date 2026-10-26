import { createAttemptRepository } from './attempt-repository';
import { createSessionRepository } from './session-repository';
import { deriveCourseGuidance } from '../training/v2/course-guidance';
import { sessionOccurredAt, summarizeProgress } from '../training/v2/progress-summary';
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
  const recentSessions = history.filter((session) => {
    const occurred = Date.parse(sessionOccurredAt(session));
    return occurred >= now - 7 * 86400000 && occurred <= now;
  });
  const knownCharacters = recordedCharacters(allAttempts);
  return {
    knownCharacters,
    returning: returningLearner(history, knownCharacters, nowIso),
    hasActivity:
      allAttempts.length > 0 ||
      history.some(
        (session) => (session.completedPromptCount ?? 0) > 0 || session.status === 'completed'
      ),
    guidance: deriveCourseGuidance(recentAttempts, nowIso),
    unfinishedSession,
    summary: summarizeProgress(recentAttempts, recentSessions, nowIso)
  };
}

export type HomeDashboard = Awaited<ReturnType<typeof loadHomeDashboard>>;

/** Device-only coaching/screening history. Never enters the existing training outbox. */
import type { AttemptRepository } from './attempt-repository';
import type { SessionRepository } from './session-repository';
import { reqToPromise, withTransaction, TRAINING_DB_OPEN_TIMEOUT_MS } from './training-db';
import { payloadKey } from './owned-training';
import { notifyTrainingDataChange } from './training-data-events';
import { summarizeReview, type ReviewPlan, type ReviewPurpose } from '../training/targeted-review';
import type { AttemptEvent, TrainingSessionRecord } from '../training/v2/types';

export const LEARNING_PILOT_DB_NAME = 'opencw_learning_pilot_v1';
interface PilotSession {
  id: string;
  ownerKey: string;
  policyVersion: 'learning-policy-1.0';
  plan: ReviewPlan;
  lessonContext: number;
  startedAt: string;
  completedAt?: string;
  status: TrainingSessionRecord['status'];
  completedPromptCount: number;
  eventIds: string[];
}
type OwnedAttempt = AttemptEvent & { ownerKey: string };
export interface LearningPilotHistory {
  id: string;
  purpose: ReviewPurpose;
  targets: string[];
  startedAt: string;
  completedAt?: string;
  status: TrainingSessionRecord['status'];
  promptCount: number;
  completedPromptCount: number;
  attempts: AttemptEvent[];
  counts: ReturnType<typeof summarizeReview>;
  localOnly: true;
}
const stores = ['sessions', 'attempts'] as const;
const validTime = (value: string) => value.includes('T') && Number.isFinite(Date.parse(value));

export async function openLearningPilotDb(
  customFactory?: IDBFactory,
  dbName = LEARNING_PILOT_DB_NAME
): Promise<IDBDatabase> {
  const factory = customFactory ?? (typeof window === 'undefined' ? undefined : window.indexedDB);
  if (!factory) throw new Error('IndexedDB is unavailable for local learning history');
  return new Promise((resolve, reject) => {
    const request = factory.open(dbName, 1);
    let abandoned = false;
    const fail = (error: Error) => {
      abandoned = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error('Opening local learning history timed out'));
      try {
        request.transaction?.abort();
      } catch {
        /* An abandoned open may finish later. */
      }
    }, TRAINING_DB_OPEN_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      if (abandoned) {
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      const sessions = db.createObjectStore('sessions', { keyPath: ['ownerKey', 'id'] });
      sessions.createIndex('ownerKey', 'ownerKey');
      const attempts = db.createObjectStore('attempts', { keyPath: ['ownerKey', 'id'] });
      attempts.createIndex('ownerKey', 'ownerKey');
      attempts.createIndex('sessionId', ['ownerKey', 'sessionId']);
      attempts.createIndex('prompt', ['ownerKey', 'sessionId', 'promptId'], { unique: true });
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      if (abandoned) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? new Error('Cannot open local learning history'));
    request.onblocked = () => fail(new Error('Close other tabs to open local learning history'));
  });
}

function adapterSession(record: PilotSession): TrainingSessionRecord {
  const settings = record.plan.prompts[0].spec;
  return {
    schemaVersion: 1,
    id: record.id,
    mode: 'guided',
    step: record.lessonContext,
    charWpm: settings.charWpm,
    effWpm: settings.effWpm,
    freqHz: settings.freqHz,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    promptCount: record.plan.prompts.length,
    completedPromptCount: record.completedPromptCount,
    eventIds: [...record.eventIds]
  };
}
function withoutOwner(record: OwnedAttempt): AttemptEvent {
  const { ownerKey: _owner, ...attempt } = record;
  void _owner;
  return attempt;
}
async function ownerSessions(db: IDBDatabase, ownerKey: string): Promise<PilotSession[]> {
  return withTransaction(db, 'sessions', 'readonly', (s) =>
    reqToPromise(s.sessions.index('ownerKey').getAll(ownerKey))
  );
}
async function ownerAttempts(db: IDBDatabase, ownerKey: string): Promise<AttemptEvent[]> {
  const records = await withTransaction(db, 'attempts', 'readonly', (s) =>
    reqToPromise<OwnedAttempt[]>(s.attempts.index('ownerKey').getAll(ownerKey))
  );
  return records.map(withoutOwner);
}

/** Existing controller port shapes are adapted here; stored rows retain their real purpose. */
export function createLearningPilotRepositories(
  db: IDBDatabase,
  ownerKey: string,
  sourcePlan: ReviewPlan
): {
  attemptRepo: AttemptRepository;
  sessionRepo: SessionRepository;
} {
  if (!ownerKey.trim()) throw new Error('Learning history requires an owner');
  const plan = structuredClone(sourcePlan);
  if (
    !['coaching', 'return-screening'].includes(plan.purpose) ||
    !plan.prompts.length ||
    new Set(plan.prompts.map((p) => p.id)).size !== plan.prompts.length ||
    plan.prompts.some((p) => p.isScored || p.spec.kind !== 'recall')
  )
    throw new Error('Local pilot requires an unscored review plan');
  const settings = plan.prompts[0].spec;
  const allAttempts = () => ownerAttempts(db, ownerKey);
  const allSessions = () => ownerSessions(db, ownerKey);
  const changed = () => notifyTrainingDataChange(ownerKey, false, 'learning-pilot');
  const saveAttempts = async (attempts: AttemptEvent[]) => {
    await withTransaction(db, [...stores], 'readwrite', async (s) => {
      for (const a of attempts) {
        const session = await reqToPromise<PilotSession | undefined>(
          s.sessions.get([ownerKey, a.sessionId])
        );
        if (!session || payloadKey(session.plan) !== payloadKey(plan))
          throw new Error('Unknown review session');
        const prompt = session.plan.prompts.find((p) => p.id === a.promptId);
        const correct = a.enteredText.trim().toUpperCase() === prompt?.spec.expectedText;
        if (
          !a.id.trim() ||
          !prompt ||
          a.schemaVersion !== 1 ||
          a.classification !== 'unmeasured' ||
          a.promptKind !== prompt.spec.kind ||
          a.targetCharacter !== prompt.spec.expectedText ||
          a.isCorrect !== correct ||
          !validTime(a.createdAt) ||
          !Number.isInteger(a.latencyMs) ||
          a.latencyMs < 0 ||
          !Number.isInteger(a.replayCount) ||
          a.replayCount < 0 ||
          !['keyboard', 'grid', 'touch'].includes(a.inputMode) ||
          a.charWpm !== prompt.spec.charWpm ||
          a.effWpm !== prompt.spec.effWpm ||
          a.freqHz !== prompt.spec.freqHz
        )
          throw new Error('Invalid local review attempt');
        const previous = await reqToPromise<OwnedAttempt | undefined>(
          s.attempts.get([ownerKey, a.id])
        );
        if (previous) {
          if (payloadKey(withoutOwner(previous)) !== payloadKey(a))
            throw new Error('Immutable review attempt conflict');
          continue;
        }
        if (session.status !== 'in-progress') throw new Error('Review session is finalized');
        if (
          await reqToPromise(s.attempts.index('prompt').getKey([ownerKey, a.sessionId, a.promptId]))
        )
          throw new Error('A first response already exists for this review prompt');
        await reqToPromise(s.attempts.add({ ...a, ownerKey }));
        await reqToPromise(
          s.sessions.put({
            ...session,
            completedPromptCount: session.completedPromptCount + 1,
            eventIds: [...session.eventIds, a.id].sort()
          })
        );
      }
    });
    changed();
  };
  const saveSession = async (input: TrainingSessionRecord) => {
    if (
      !input.id.trim() ||
      input.mode === 'practice' ||
      input.promptCount !== plan.prompts.length ||
      input.charWpm !== settings.charWpm ||
      input.effWpm !== settings.effWpm ||
      input.freqHz !== settings.freqHz ||
      !validTime(input.startedAt) ||
      !['in-progress', 'completed', 'abandoned'].includes(input.status) ||
      (input.completedAt !== undefined &&
        (!validTime(input.completedAt) ||
          Date.parse(input.completedAt) < Date.parse(input.startedAt))) ||
      (input.status === 'completed' && !input.completedAt)
    )
      throw new Error('Invalid local review session');
    await withTransaction(db, [...stores], 'readwrite', async (s) => {
      const previous = await reqToPromise<PilotSession | undefined>(
        s.sessions.get([ownerKey, input.id])
      );
      if (
        previous &&
        (payloadKey(previous.plan) !== payloadKey(plan) ||
          previous.startedAt !== input.startedAt ||
          previous.lessonContext !== input.step)
      )
        throw new Error('Immutable review plan conflict');
      const attempts = await reqToPromise<OwnedAttempt[]>(
        s.attempts.index('sessionId').getAll([ownerKey, input.id])
      );
      const record: PilotSession = {
        id: input.id,
        ownerKey,
        policyVersion: 'learning-policy-1.0',
        plan,
        lessonContext: input.step,
        startedAt: input.startedAt,
        status: input.status,
        ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
        completedPromptCount: attempts.length,
        eventIds: attempts.map((a) => a.id).sort()
      };
      if (record.status === 'completed' && attempts.length !== plan.prompts.length)
        throw new Error('A completed review requires every planned response');
      if (
        previous?.status !== 'in-progress' &&
        previous &&
        payloadKey(previous) !== payloadKey(record)
      )
        throw new Error('Immutable terminal review conflict');
      await reqToPromise(s.sessions.put(record));
    });
    changed();
  };
  return {
    attemptRepo: {
      saveAttempt: (attempt) => saveAttempts([attempt]),
      saveAttempts,
      getAttempt: async (id) => (await allAttempts()).find((a) => a.id === id) ?? null,
      getAttemptsBySession: async (id) => (await allAttempts()).filter((a) => a.sessionId === id),
      getAttemptsByCharacter: async (character, limit) => {
        const found = (await allAttempts()).filter((a) => a.targetCharacter === character);
        return limit === undefined ? found : found.slice(0, Math.max(0, limit));
      },
      getAttemptsByTimeRange: async (start, end) =>
        (await allAttempts())
          .filter((a) => a.createdAt >= start && a.createdAt <= end)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      countAttempts: async () => (await allAttempts()).length
    },
    sessionRepo: {
      saveSession,
      getSession: async (id) => {
        const record = (await allSessions()).find((s) => s.id === id);
        return record ? adapterSession(record) : null;
      },
      getLatestInProgressSession: async () => {
        const record = (await allSessions())
          .filter((s) => s.status === 'in-progress')
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        return record ? adapterSession(record) : null;
      },
      getSessions: async (limit, status) => {
        const records = (await allSessions())
          .filter((s) => !status || s.status === status)
          .sort((a, b) =>
            (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)
          );
        return (limit === undefined ? records : records.slice(0, limit)).map(adapterSession);
      },
      getSessionsByTimeRange: async (start, end) =>
        (await allSessions())
          .filter(
            (s) => (s.completedAt ?? s.startedAt) >= start && (s.completedAt ?? s.startedAt) <= end
          )
          .map(adapterSession),
      updateSessionProgress: async (id, _completed, status, completedAt) => {
        const previous = (await allSessions()).find((s) => s.id === id);
        if (!previous) throw new Error('Unknown review session');
        await saveSession({
          ...adapterSession(previous),
          status: status ?? previous.status,
          ...(completedAt === undefined ? {} : { completedAt })
        });
      }
    }
  };
}

export async function getLearningPilotHistory(
  db: IDBDatabase,
  ownerKey: string
): Promise<LearningPilotHistory[]> {
  const [sessions, ownedAttempts] = await withTransaction(db, [...stores], 'readonly', (s) =>
    Promise.all([
      reqToPromise<PilotSession[]>(s.sessions.index('ownerKey').getAll(ownerKey)),
      reqToPromise<OwnedAttempt[]>(s.attempts.index('ownerKey').getAll(ownerKey))
    ])
  );
  const attempts = ownedAttempts.map(withoutOwner);
  return sessions
    .map((s) => {
      const responses = attempts.filter((a) => a.sessionId === s.id);
      return {
        id: s.id,
        purpose: s.plan.purpose,
        targets: [...s.plan.targets],
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        status: s.status,
        promptCount: s.plan.prompts.length,
        completedPromptCount: responses.length,
        attempts: responses,
        counts: summarizeReview(responses),
        localOnly: true as const
      };
    })
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
}

/** Prospective review/check capture through existing controller ports. Legacy history is untouched. */
import type { EvidenceAudioEngine, EvidencePresentation } from '../audio/evidence-engine';
import type { AttemptRepository } from './attempt-repository';
import type { SessionRepository } from './session-repository';
import { type LearningEvidenceRepository, type EvidenceRecord } from './learning-evidence';
import type { GoalProfile } from '../training/learning-policy/types';
import type { AttemptEvent, Prompt, TrainingSessionRecord } from '../training/v2/types';
import { evaluateCheck } from '../training/learning-policy/assessment';
import { checkPlanFromWire, observationFromWire } from './learning-snapshot';

export interface LearningSessionPlan {
  purpose: 'coaching' | 'screening' | 'mixed-check';
  targets: readonly string[];
  knownCharacters: readonly string[];
  prompts: readonly Prompt[];
  profile: GoalProfile;
  reviewCycleIds?: Readonly<Record<string, string>>;
}
export function createEvidenceSessionRepositories(
  repo: LearningEvidenceRepository,
  ownerKey: string,
  metadata: LearningSessionPlan,
  audio: EvidenceAudioEngine
): {
  attemptRepo: AttemptRepository;
  sessionRepo: SessionRepository;
  captureFirst: (prompt: Prompt) => void;
} {
  const first = new Map<string, EvidencePresentation>();
  const frozen = new Map<string, EvidenceRecord>();
  const attempts = new Map<string, AttemptEvent>();
  let session: TrainingSessionRecord | null = null;
  const envelope = (
    id: string,
    kind: EvidenceRecord['kind'],
    payload: Record<string, unknown>
  ): EvidenceRecord => ({
    id,
    kind,
    policy_version: 'learning-policy-1.0',
    recorded_at: new Date().toISOString(),
    ...payload
  });
  const planRecord = (record: TrainingSessionRecord) =>
    envelope(`plan_${record.id}`, 'plan', {
      session_id: record.id,
      purpose: metadata.purpose,
      curriculum_version: 'koch-39-v1',
      profile: {
        id: metadata.profile.id,
        task: metadata.profile.task,
        char_wpm: metadata.profile.charWpm,
        audio_condition: metadata.profile.audioCondition,
        response_support: metadata.profile.responseSupport
      },
      char_wpm: record.charWpm,
      eff_wpm: record.effWpm,
      freq_hz: record.freqHz,
      started_at: record.startedAt,
      introduced_characters: [...metadata.knownCharacters],
      targets:
        metadata.purpose === 'screening'
          ? [...new Set(metadata.prompts.map((p) => p.spec.expectedText))]
          : [...metadata.targets],
      prompts: metadata.prompts.map((p) => ({
        id: p.id,
        character: p.spec.expectedText,
        role:
          metadata.purpose === 'screening' || metadata.targets.includes(p.spec.expectedText)
            ? 'target'
            : 'anchor'
      })),
      fresh_order: true,
      feedback: metadata.purpose === 'mixed-check' ? 'after-check' : 'immediate',
      ...(metadata.purpose === 'mixed-check'
        ? { review_cycle_ids: { ...metadata.reviewCycleIds } }
        : {})
    });
  const persistAttempt = async (attempt: AttemptEvent) => {
    if (
      !session ||
      attempt.sessionId !== session.id ||
      !metadata.prompts.some((p) => p.id === attempt.promptId)
    )
      throw new Error('Unknown learning prompt');
    let record = frozen.get(attempt.id);
    if (!record) {
      const presentation = first.get(attempt.promptId);
      if (!presentation) throw new Error('Missing first presentation evidence');
      // This first object stays attached through replay, errors and interruptions.
      record = envelope(attempt.id, 'observation', {
        session_id: attempt.sessionId,
        prompt_id: attempt.promptId,
        presentation_id: presentation.id,
        first_response: attempt.enteredText || null,
        final_response: attempt.enteredText || null,
        skipped: !attempt.enteredText.trim(),
        replay_count_before_response: attempt.replayCount,
        help_before_response: false,
        audio_valid: presentation.valid,
        interruption_invalidated: presentation.interrupted,
        response_interface: attempt.inputMode === 'keyboard' ? 'keyboard' : 'restricted',
        first_presented_at: presentation.startedAt,
        prior_exposure: presentation.priorExposure[attempt.targetCharacter] ?? null,
        char_wpm: attempt.charWpm,
        eff_wpm: attempt.effWpm,
        freq_hz: attempt.freqHz
      });
      frozen.set(attempt.id, record);
    }
    await repo.append([record]);
    attempts.set(attempt.id, structuredClone(attempt));
  };
  const finalize = async (status: string, endedAt?: string) => {
    if (!session) throw new Error('Unknown learning session');
    const key = `end_${session.id}`;
    let terminal = frozen.get(key);
    if (!terminal) {
      const records = await repo.all(),
        observations = records.filter(
          (r) => r.kind === 'observation' && r.session_id === session!.id
        );
      const plan = frozen.get(`plan_${session.id}`)!;
      const check = metadata.purpose === 'mixed-check' ? checkPlanFromWire(plan, ownerKey) : null;
      const complete = check
        ? evaluateCheck(
            check,
            observations.map((r) => observationFromWire(r, ownerKey)),
            endedAt ?? null
          ).complete
        : true;
      terminal = envelope(key, 'terminal', {
        session_id: session.id,
        status: status === 'completed' && !complete ? 'incomplete' : status,
        ended_at: endedAt ?? null,
        observation_ids: observations.map((r) => r.id).sort()
      });
      frozen.set(key, terminal);
    }
    await audio.flush();
    await repo.append([terminal]);
  };
  const allAttempts = () => [...attempts.values()];
  return {
    captureFirst(prompt) {
      const presentation = audio.presentation();
      if (presentation && !first.has(prompt.id)) first.set(prompt.id, presentation);
    },
    attemptRepo: {
      saveAttempt: persistAttempt,
      saveAttempts: async (values) => {
        for (const value of values) await persistAttempt(value);
      },
      getAttempt: async (id) => attempts.get(id) ?? null,
      getAttemptsBySession: async (id) => allAttempts().filter((a) => a.sessionId === id),
      getAttemptsByCharacter: async (ch, limit) =>
        allAttempts()
          .filter((a) => a.targetCharacter === ch)
          .slice(0, limit),
      getAttemptsByTimeRange: async (start, end) =>
        allAttempts().filter((a) => a.createdAt >= start && a.createdAt <= end),
      countAttempts: async () => attempts.size
    },
    sessionRepo: {
      async saveSession(value) {
        const key = `plan_${value.id}`;
        const record = frozen.get(key) ?? planRecord(value);
        frozen.set(key, record);
        await repo.append([record]);
        session = structuredClone(value);
      },
      getSession: async (id) => (session?.id === id ? session : null),
      getLatestInProgressSession: async () => (session?.status === 'in-progress' ? session : null),
      getSessions: async (_limit, status) =>
        session && (!status || session.status === status) ? [session] : [],
      getSessionsByTimeRange: async (start, end) =>
        session && session.startedAt >= start && session.startedAt <= end ? [session] : [],
      async updateSessionProgress(id, count, status, endedAt) {
        if (!session || session.id !== id) throw new Error('Unknown learning session');
        if (status && status !== 'in-progress') await finalize(status, endedAt);
        session = {
          ...session,
          completedPromptCount: count,
          status: status ?? session.status,
          ...(endedAt ? { completedAt: endedAt } : {})
        };
      }
    }
  };
}

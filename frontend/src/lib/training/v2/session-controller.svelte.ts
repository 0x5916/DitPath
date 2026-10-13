/**
 * Guided Session Controller for DitPath V2.
 *
 * Svelte 5 reactive controller orchestrating:
 * - Pure guided-session state machine (`guidedSessionTransition`)
 * - Web Audio engine (`AudioEngine`) and `AudioPlan` synthesis
 * - Transactional repositories (`AttemptRepository`, `SessionRepository`)
 * - High-resolution timing and latency measurement
 * - Browser interruption resilience (visibility changes, audio stops, unmount disposal)
 *
 * Presentation components consume this controller and emit user intent.
 * Direct IndexedDB, audio scheduling, or mastery calculations NEVER occur in UI components.
 */

import type { AudioEngine, AudioEngineEvent } from '../../audio/engine';
import { SvelteDate } from 'svelte/reactivity';
import { buildAudioPlan } from '../timing';
import type { AttemptRepository } from '../../data/attempt-repository';
import type { SessionRepository } from '../../data/session-repository';
import { scorePromptAttempt } from './attempt';
import {
  createGuidedSession,
  guidedSessionTransition,
  type GuidedSessionEffect,
  type GuidedSessionEvent,
  type GuidedSessionState
} from './guided-session';
import { createAttemptId, createSessionId } from './ids';
import { buildLessonPlan } from './lesson-builder';
import type {
  AttemptEvent,
  InputMode,
  MasteryPolicy,
  Prompt,
  TrainingSessionRecord
} from './types';

export interface SessionControllerDependencies {
  sessionId?: string;
  step: number;
  prompts?: Prompt[];
  clock?: () => number;
  nowIso?: () => string;
  audioEngine: AudioEngine;
  attemptRepo: AttemptRepository;
  sessionRepo: SessionRepository;
  masteryPolicy?: MasteryPolicy;
  allHistoricalAttempts?: AttemptEvent[];
  volume?: number;
  charWpm?: number;
  effWpm?: number;
  freqHz?: number;
}

export class GuidedSessionController {
  #clock: () => number;
  #nowIso: () => string;
  #audioEngine: AudioEngine;
  #attemptRepo: AttemptRepository;
  #sessionRepo: SessionRepository;
  #masteryPolicy?: MasteryPolicy;
  #allHistoricalAttempts: AttemptEvent[];
  #volume: number;
  #audioUnsubscribe: (() => void) | null = null;
  #disposed = false;

  // Svelte 5 reactive state
  state = $state<GuidedSessionState>({
    phase: 'idle',
    sessionId: '',
    step: 1,
    prompts: [],
    currentPromptIndex: 0,
    currentPrompt: null,
    replayCount: 0,
    answerReadyAtMs: null,
    attempts: [],
    lastAttempt: null,
    pausedFromPhase: null,
    summary: null,
    audioError: null
  });

  persistenceError = $state<string | null>(null);
  feedbackCharacter = $state<string | null>(null);
  feedbackAudioError = $state<string | null>(null);

  constructor(deps: SessionControllerDependencies) {
    this.#clock = deps.clock ?? (() => Date.now());
    this.#nowIso = deps.nowIso ?? (() => new SvelteDate().toISOString());
    this.#audioEngine = deps.audioEngine;
    this.#attemptRepo = deps.attemptRepo;
    this.#sessionRepo = deps.sessionRepo;
    this.#masteryPolicy = deps.masteryPolicy;
    this.#allHistoricalAttempts = deps.allHistoricalAttempts ?? [];
    this.#volume = deps.volume ?? 1.0;

    const sessionId = deps.sessionId ?? createSessionId({ now: this.#clock });
    const prompts =
      deps.prompts ??
      buildLessonPlan(deps.step, {
        charWpm: deps.charWpm ?? 20,
        effWpm: deps.effWpm ?? 12,
        freqHz: deps.freqHz ?? 600
      });

    this.state = createGuidedSession({
      sessionId,
      step: deps.step,
      prompts
    });

    // Subscribe to audio engine completion
    this.#audioUnsubscribe = this.#audioEngine.subscribe((event: AudioEngineEvent) => {
      // Closing an older context may notify after another playback starts.
      if (event === 'ended' && !this.#audioEngine.isActive()) {
        this.onAudioEnded();
      }
    });
  }

  get phase() {
    return this.state.phase;
  }

  get currentPrompt() {
    return this.state.currentPrompt;
  }

  get currentPromptIndex() {
    return this.state.currentPromptIndex;
  }

  get totalPrompts() {
    return this.state.prompts.length;
  }

  get attempts() {
    return this.state.attempts;
  }

  get lastAttempt() {
    return this.state.lastAttempt;
  }

  get summary() {
    return this.state.summary;
  }

  get replayCount() {
    return this.state.replayCount;
  }

  /**
   * Dispatches an event through the state machine and executes resulting effects.
   */
  #dispatch(event: GuidedSessionEvent): boolean {
    if (this.#disposed) return false;

    const transitionResult = guidedSessionTransition(
      this.state,
      event,
      this.#allHistoricalAttempts,
      this.#nowIso()
    );

    if (!transitionResult.ok) {
      return false;
    }

    this.state = transitionResult.state;
    this.#executeEffects(transitionResult.effects);
    return true;
  }

  #executeEffects(effects: GuidedSessionEffect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'play-audio': {
          this.#playPromptAudio(effect.prompt);
          break;
        }
        case 'record-attempt': {
          this.#persistAttempt(effect.attempt);
          break;
        }
        case 'session-complete': {
          this.#persistSessionCompletion(effect.summary.sessionId);
          break;
        }
        case 'session-abandoned': {
          this.#persistSessionAbandon(effect.sessionId);
          break;
        }
      }
    }
  }

  #playPromptAudio(prompt: Prompt, text = prompt.spec.expectedText, feedback = false): void {
    try {
      const plan = buildAudioPlan(text, {
        charWpm: prompt.spec.charWpm,
        effWpm: prompt.spec.effWpm,
        frequency: prompt.spec.freqHz,
        startDelay: 0.1,
        volume: this.#volume
      });
      if (plan.events.length === 0) throw new Error('No playable Morse characters');
      this.#audioEngine.play(plan);
    } catch (err) {
      void this.#audioEngine.stop({ notify: false });
      const msg = err instanceof Error ? err.message : 'Audio playback error';
      if (feedback) {
        this.feedbackCharacter = null;
        this.feedbackAudioError = msg;
      } else {
        this.#dispatch({ type: 'audio-error', error: msg });
      }
    }
  }

  async #persistAttempt(attempt: AttemptEvent): Promise<void> {
    try {
      await this.#attemptRepo.saveAttempt(attempt);
      await this.#sessionRepo.updateSessionProgress(
        this.state.sessionId,
        this.state.attempts.length
      );
      this.persistenceError = null;
    } catch (err) {
      // Persistence error surfaced without breaking in-memory session progression
      this.persistenceError =
        err instanceof Error ? err.message : 'Failed to save attempt to storage';
    }
  }

  async #persistSessionCompletion(sessionId: string): Promise<void> {
    try {
      await this.#sessionRepo.updateSessionProgress(
        sessionId,
        this.state.attempts.length,
        'completed',
        this.#nowIso()
      );
    } catch (err) {
      this.persistenceError =
        err instanceof Error ? err.message : 'Failed to save session completion';
    }
  }

  async #persistSessionAbandon(sessionId: string): Promise<void> {
    try {
      await this.#sessionRepo.updateSessionProgress(
        sessionId,
        this.state.attempts.length,
        'abandoned',
        this.#nowIso()
      );
    } catch (err) {
      this.persistenceError = err instanceof Error ? err.message : 'Failed to save session abandon';
    }
  }

  /**
   * Starts the session and registers the initial TrainingSessionRecord.
   */
  async start(): Promise<void> {
    if (this.state.phase !== 'idle') return;

    const record: TrainingSessionRecord = {
      schemaVersion: 1,
      id: this.state.sessionId,
      step: this.state.step,
      charWpm: this.state.currentPrompt?.spec.charWpm ?? 20,
      effWpm: this.state.currentPrompt?.spec.effWpm ?? 12,
      freqHz: this.state.currentPrompt?.spec.freqHz ?? 600,
      startedAt: this.#nowIso(),
      status: 'in-progress',
      promptCount: this.state.prompts.length,
      completedPromptCount: 0
    };

    try {
      await this.#sessionRepo.saveSession(record);
    } catch (err) {
      this.persistenceError =
        err instanceof Error ? err.message : 'Failed to initialize session record';
    }

    this.#dispatch({ type: 'start' });
  }

  play(): void {
    this.#dispatch({ type: 'play' });
  }

  replay(): void {
    this.#dispatch({ type: 'replay' });
  }

  /** Audition either side of feedback without changing scoring or prompt timing. */
  playFeedback(text: string): void {
    const prompt = this.currentPrompt;
    if (
      this.#disposed ||
      this.phase !== 'feedback' ||
      !prompt ||
      !text ||
      ![prompt.spec.expectedText, this.lastAttempt?.enteredText].includes(text)
    )
      return;
    this.feedbackAudioError = null;
    this.feedbackCharacter = text;
    this.#playPromptAudio(prompt, text, true);
  }

  #stopFeedback(): void {
    if (this.feedbackCharacter) void this.#audioEngine.stop({ notify: false });
    this.feedbackCharacter = null;
    this.feedbackAudioError = null;
  }

  onAudioEnded(): void {
    if (this.feedbackCharacter) {
      this.feedbackCharacter = null;
      return;
    }
    const endedAtMs = this.#clock();
    this.#dispatch({ type: 'play-end', endedAtMs });
  }

  submitAnswer(enteredText: string, inputMode: InputMode): boolean {
    if (this.state.phase !== 'answering' || !this.state.currentPrompt) {
      return false;
    }

    const answerReadyAtMs = this.state.answerReadyAtMs ?? this.#clock();
    const submittedAtMs = this.#clock();

    const attempt = scorePromptAttempt({
      prompt: this.state.currentPrompt,
      sessionId: this.state.sessionId,
      enteredText,
      answerReadyAtMs,
      submittedAtMs: Math.max(submittedAtMs, answerReadyAtMs),
      replayCount: this.state.replayCount,
      inputMode,
      policy: this.#masteryPolicy,
      idGenerator: () => createAttemptId({ now: this.#clock }),
      nowIso: this.#nowIso()
    });

    return this.#dispatch({ type: 'submit-answer', attempt });
  }

  continue(): boolean {
    this.#stopFeedback();
    return this.#dispatch({ type: 'continue' });
  }

  pause(): void {
    this.#stopFeedback();
    if (this.#audioEngine.isActive() && !this.#audioEngine.isPaused()) {
      void this.#audioEngine.pause();
    }
    this.#dispatch({ type: 'pause' });
  }

  resume(): void {
    if (this.state.pausedFromPhase === 'playing') {
      // The state machine returns to ready, so discard the interrupted tone.
      void this.#audioEngine.stop({ notify: false });
    } else if (this.#audioEngine.isPaused()) {
      void this.#audioEngine.resume();
    }
    this.#dispatch({ type: 'resume' });
  }

  abandon(): void {
    this.#stopFeedback();
    void this.#audioEngine.stop({ notify: false });
    this.#dispatch({ type: 'abandon' });
  }

  handleVisibilityChange(hidden: boolean): void {
    if (hidden) this.#stopFeedback();
    if (hidden && (this.state.phase === 'playing' || this.state.phase === 'answering')) {
      this.pause();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.feedbackCharacter = null;

    if (this.#audioUnsubscribe) {
      this.#audioUnsubscribe();
      this.#audioUnsubscribe = null;
    }

    void this.#audioEngine.dispose();
  }
}

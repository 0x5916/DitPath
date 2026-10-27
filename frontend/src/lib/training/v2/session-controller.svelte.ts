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
  resume?: { state: GuidedSessionState; record: TrainingSessionRecord; draft: string };
  saveCheckpoint?: (
    state: GuidedSessionState,
    record: TrainingSessionRecord,
    draft: string
  ) => Promise<void>;
  step: number;
  prompts?: Prompt[];
  clock?: () => number;
  nowIso?: () => string;
  audioEngine: AudioEngine;
  attemptRepo: AttemptRepository;
  sessionRepo: SessionRepository;
  allowProgression?: boolean;
  feedback?: 'immediate' | 'after-check';
  onPromptPlayback?: (prompt: Prompt) => void;
  masteryPolicy?: MasteryPolicy;
  allHistoricalAttempts?: AttemptEvent[];
  volume?: number;
  charWpm?: number;
  effWpm?: number;
  freqHz?: number;
}

export type SessionPersistenceStatus = 'saving' | 'saved' | 'failed';

export class GuidedSessionController {
  #checkpoint?: SessionControllerDependencies['saveCheckpoint'];
  #draft = '';
  #restored = false;
  #clock: () => number;
  #nowIso: () => string;
  #audioEngine: AudioEngine;
  #attemptRepo: AttemptRepository;
  #sessionRepo: SessionRepository;
  #allowProgression: boolean;
  #deferredFeedback: boolean;
  #onPromptPlayback?: (prompt: Prompt) => void;
  #masteryPolicy?: MasteryPolicy;
  #allHistoricalAttempts: AttemptEvent[];
  #volume: number;
  #audioUnsubscribe: (() => void) | null = null;
  #disposed = false;
  #persistenceQueue: (() => Promise<void>)[] = [];
  #persistenceRun: Promise<void> | null = null;
  #initialRecord: TrainingSessionRecord | null = null;
  #disposePromise: Promise<void> | null = null;
  #completedPromptCount = 0;

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

  restoring = $state(false);
  persistenceError = $state<string | null>(null);
  persistenceStatus = $state<SessionPersistenceStatus>('saving');
  feedbackCharacter = $state<string | null>(null);
  feedbackAudioError = $state<string | null>(null);

  constructor(deps: SessionControllerDependencies) {
    this.#checkpoint = deps.saveCheckpoint;
    this.#clock = deps.clock ?? (() => Date.now());
    this.#nowIso = deps.nowIso ?? (() => new SvelteDate().toISOString());
    this.#audioEngine = deps.audioEngine;
    this.#attemptRepo = deps.attemptRepo;
    this.#sessionRepo = deps.sessionRepo;
    this.#allowProgression = deps.allowProgression ?? true;
    this.#deferredFeedback = deps.feedback === 'after-check';
    this.#onPromptPlayback = deps.onPromptPlayback;
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

    if (deps.resume) {
      const saved = structuredClone(deps.resume.state);
      this.#initialRecord = structuredClone(deps.resume.record);
      this.#draft = deps.resume.draft;
      this.#completedPromptCount = deps.resume.record.completedPromptCount;
      this.#restored = true;
      this.restoring = true;
      if (saved.phase !== 'feedback') {
        const interrupted = ['playing', 'answering', 'paused'].includes(saved.phase);
        saved.phase = 'paused';
        saved.pausedFromPhase =
          saved.currentPrompt?.spec.kind === 'introduction' ? 'introducing' : 'ready';
        saved.answerReadyAtMs = null;
        if (interrupted) {
          saved.replayCount = Math.max(1, saved.replayCount);
          if (saved.currentPrompt)
            saved.currentPrompt = {
              ...saved.currentPrompt,
              spec: { ...saved.currentPrompt.spec },
              isScored: false
            };
        }
      }
      this.state = saved;
    }

    // Subscribe to audio engine completion
    this.#audioUnsubscribe = this.#audioEngine.subscribe((event: AudioEngineEvent) => {
      // Closing an older context may notify after another playback starts.
      if (event === 'error') {
        this.feedbackCharacter = null;
        this.#dispatch({ type: 'audio-error', error: 'Audio or evidence storage failed' });
      }
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
      this.#nowIso(),
      this.#allowProgression
    );

    if (!transitionResult.ok) {
      return false;
    }

    if (event.type === 'continue') {
      this.#completedPromptCount = this.state.currentPromptIndex + 1;
    } else if (event.type === 'submit-answer') {
      this.#completedPromptCount = this.state.currentPromptIndex + 1;
    }
    this.state = transitionResult.state;
    const terminal = ['complete', 'abandoned'].includes(this.state.phase);
    if (!terminal && event.type === 'submit-answer') this.#saveCheckpoint();
    this.#executeEffects(transitionResult.effects);
    if (terminal || event.type !== 'submit-answer') this.#saveCheckpoint();
    return true;
  }

  #saveCheckpoint(): void {
    if (!this.#checkpoint || !this.#initialRecord) return;
    const state = JSON.parse(JSON.stringify(this.state)) as GuidedSessionState;
    const record = { ...this.#initialRecord, completedPromptCount: this.#completedPromptCount };
    const draft = this.#draft;
    this.#enqueuePersistence(() => this.#checkpoint!(state, record, draft));
  }
  setDraft(value: string) {
    if (value !== this.#draft) {
      this.#draft = value;
      this.#saveCheckpoint();
    }
  }
  suspend() {
    this.pause();
    void this.#audioEngine.stop({ notify: false });
    this.#saveCheckpoint();
  }

  #executeEffects(effects: GuidedSessionEffect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'play-audio': {
          this.#playPromptAudio(effect.prompt);
          break;
        }
        case 'record-attempt': {
          this.#enqueuePersistence(async () => {
            await this.#attemptRepo.saveAttempt(effect.attempt);
          });
          break;
        }
        case 'session-complete': {
          const { sessionId, completedAt } = effect.summary;
          const completedPromptCount = this.state.prompts.length;
          this.#enqueuePersistence(() =>
            this.#sessionRepo.updateSessionProgress(
              sessionId,
              completedPromptCount,
              'completed',
              completedAt
            )
          );
          break;
        }
        case 'session-abandoned': {
          const completedPromptCount = this.#completedPromptCount;
          const completedAt = this.#nowIso();
          this.#enqueuePersistence(() =>
            this.#sessionRepo.updateSessionProgress(
              effect.sessionId,
              completedPromptCount,
              'abandoned',
              completedAt
            )
          );
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
      if (!feedback) this.#onPromptPlayback?.(prompt);
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

  #enqueuePersistence(write: () => Promise<void>): void {
    this.#persistenceQueue.push(write);
    if (this.persistenceStatus !== 'failed') this.persistenceStatus = 'saving';
    this.#schedulePersistence();
  }

  #schedulePersistence(): void {
    if (this.#persistenceRun || this.persistenceStatus === 'failed') return;
    this.persistenceStatus = 'saving';
    const run = this.#drainPersistence();
    this.#persistenceRun = run;
    void run.then(() => {
      this.#persistenceRun = null;
      if (this.#persistenceQueue.length && this.persistenceStatus !== 'failed') {
        this.#schedulePersistence();
      }
    });
  }

  async #drainPersistence(): Promise<void> {
    while (this.#persistenceQueue.length) {
      try {
        await this.#persistenceQueue[0]();
        this.#persistenceQueue.shift();
      } catch (err) {
        // Retain the failed head and every later write. Retry uses the same IDs.
        this.persistenceError = err instanceof Error ? err.message : 'Failed to save session';
        this.persistenceStatus = 'failed';
        return;
      }
    }
    this.persistenceError = null;
    this.persistenceStatus = 'saved';
  }

  /** Wait for committed writes; a failed write remains queued until explicitly retried. */
  async flushPersistence(): Promise<boolean> {
    while (this.#persistenceRun) await this.#persistenceRun;
    return this.persistenceStatus === 'saved' && this.#persistenceQueue.length === 0;
  }

  async retryPersistence(): Promise<boolean> {
    await this.flushPersistence();
    if (this.#disposed) return false;
    if (this.#persistenceQueue.length) {
      this.persistenceStatus = 'saving';
      this.#schedulePersistence();
    }
    const saved = await this.flushPersistence();
    if (saved && this.#restored) {
      await this.start();
      return await this.flushPersistence();
    }
    if (saved && this.#initialRecord && this.phase === 'idle') this.#dispatch({ type: 'start' });
    return saved;
  }

  /** Start only after the initial record commits; retry keeps the original session identity. */
  async start(): Promise<void> {
    if (this.#restored) {
      const attempts = JSON.parse(JSON.stringify(this.state.attempts)) as AttemptEvent[];
      this.#enqueuePersistence(async () => {
        for (const a of attempts) await this.#attemptRepo.saveAttempt(a);
      });
      if (await this.flushPersistence()) {
        this.#restored = false;
        this.restoring = false;
        if (this.#deferredFeedback && this.state.phase === 'feedback') this.continue();
        else this.#saveCheckpoint();
      }
      return;
    }
    if (this.#disposed || this.state.phase !== 'idle') return;
    if (!this.#initialRecord) {
      const settings = this.state.prompts[0].spec;
      const record: TrainingSessionRecord = {
        schemaVersion: 1,
        mode: 'guided',
        id: this.state.sessionId,
        step: this.state.step,
        charWpm: settings.charWpm,
        effWpm: settings.effWpm,
        freqHz: settings.freqHz,
        startedAt: this.#nowIso(),
        status: 'in-progress',
        promptCount: this.state.prompts.length,
        completedPromptCount: 0
      };
      this.#initialRecord = record;
      this.#enqueuePersistence(() => this.#sessionRepo.saveSession(record));
    }
    if (await this.flushPersistence()) this.#dispatch({ type: 'start' });
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
      this.#deferredFeedback ||
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

    const accepted = this.#dispatch({ type: 'submit-answer', attempt });
    if (accepted && this.#deferredFeedback) this.continue();
    return accepted;
  }

  continue(): boolean {
    this.#stopFeedback();
    const advanced = this.#dispatch({ type: 'continue' });
    if (advanced && this.phase !== 'complete') {
      const sessionId = this.state.sessionId;
      const completedPromptCount = this.#completedPromptCount;
      this.#enqueuePersistence(() =>
        this.#sessionRepo.updateSessionProgress(sessionId, completedPromptCount)
      );
    }
    return advanced;
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

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.feedbackCharacter = null;

    if (this.#audioUnsubscribe) {
      this.#audioUnsubscribe();
      this.#audioUnsubscribe = null;
    }

    // Release playback immediately, but let planned cleanup keep storage open until writes settle.
    this.#disposePromise = (async () => {
      try {
        await this.#audioEngine.dispose();
      } finally {
        await this.flushPersistence();
      }
    })();
    return this.#disposePromise;
  }
}

import { createWebAudioEngine, type AudioEngine, type AudioEngineEvent } from './engine';
import { getAuthAccountId } from '../auth';
import {
  createLearningEvidenceRepository,
  openLearningEvidenceDb,
  type EvidenceRecord,
  type LearningEvidenceRepository
} from '../data/learning-evidence';
import { anchoredClock, priorExposure, type WireBounds } from '../learning-evidence/exposure';
import { MORSE } from '../training/sequence';
import type { AudioPlan } from '../training/timing';
export interface EvidencePresentation {
  id: string;
  startedAt: WireBounds | null;
  priorExposure: Record<string, WireBounds | null>;
  valid: boolean;
  interrupted: boolean;
}
export interface EvidenceAudioEngine extends AudioEngine {
  presentation(id?: string): EvidencePresentation | null;
  flush(): Promise<void>;
}
interface Options {
  ownerKey?: string;
  source: 'guided' | 'reference' | 'coaching' | 'screening' | 'mixed-check' | 'group';
  sessionId?: string;
  knownCharacters?: readonly string[];
  onError?: (error: unknown) => void;
  base?: AudioEngine;
  clock?: () => WireBounds | null;
  prepareTimeoutMs?: number;
  repository?: LearningEvidenceRepository;
  currentOwner?: () => string;
}
const activeEngines = new Set<() => Promise<void>>();
export async function stopEvidenceAudio() {
  await Promise.allSettled([...activeEngines].map((stop) => stop()));
}

/** Every potential sound is guarded durably before it can become audible. */
export function createEvidenceAudioEngine(options: Options): EvidenceAudioEngine {
  const base = options.base ?? createWebAudioEngine();
  const currentOwner =
    options.currentOwner ??
    (() => (getAuthAccountId() ? `account:${getAuthAccountId()}` : 'unclaimed'));
  const clock = options.clock ?? anchoredClock();
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const presentations = new Map<string, EvidencePresentation>();
  let current: EvidencePresentation | null = null;
  let active = false,
    disposed = false,
    generation = 0;
  let queue: Promise<void> = Promise.resolve();
  let open: {
    id: string;
    owner: string;
    characters: string[];
    presentation: EvidencePresentation;
    guard: EvidenceRecord;
    closure?: EvidenceRecord;
  } | null = null;
  const write = async (owner: string, records: EvidenceRecord[]) => {
    if (options.repository) {
      await options.repository.append(records);
      return;
    }
    const db = await openLearningEvidenceDb();
    try {
      await createLearningEvidenceRepository(db, owner).append(records);
    } finally {
      db.close();
    }
  };
  const all = async (owner: string) => {
    if (options.repository) return options.repository.all();
    const db = await openLearningEvidenceDb();
    try {
      return await createLearningEvidenceRepository(db, owner).all();
    } finally {
      db.close();
    }
  };
  const record = (
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
  const emit = (event: AudioEngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  const enqueue = (work: () => Promise<void>) => {
    const expected = generation;
    const pending = queue.then(work, work);
    queue = pending;
    void pending.catch((error) => {
      if (!disposed && expected === generation) {
        options.onError?.(error);
        active = false;
        emit('error');
      }
    });
    return pending;
  };
  async function close(reason: 'completed' | 'stopped') {
    const action = open;
    if (!action) return;
    const bounds = clock();
    if (!bounds) throw new Error('Exposure clock is uncertain; reload to recover');
    action.closure ??= record(`close_${action.id}`, 'exposure-close', {
      open_id: action.id,
      end_reason: reason,
      last_exposure: Object.fromEntries(action.characters.map((ch) => [ch, bounds]))
    });
    await write(action.owner, [action.guard, action.closure]);
    if (open === action) open = null;
    action.presentation.valid = reason === 'completed' && !action.presentation.interrupted;
  }
  const unsubscribe = base.subscribe((event) => {
    if (event === 'error') {
      active = false;
      if (current) current.interrupted = true;
      const stopped = base.stop({ notify: false });
      void enqueue(async () => {
        await stopped;
        await close('stopped');
      });
      emit('error');
      return;
    }
    if (!active) return;
    const expected = generation;
    void enqueue(async () => {
      await close('completed');
      if (!disposed && expected === generation) {
        active = false;
        emit('ended');
      }
    });
  });
  function play(plan: AudioPlan) {
    if (disposed) return;
    activeEngines.add(stopForOwnerChange);
    const characters = [...new Set([...plan.text.toUpperCase()].filter((ch) => MORSE[ch]))].sort();
    if (!characters.length) {
      base.play(plan);
      return;
    }
    if (current && active) current.interrupted = true;
    const expected = ++generation,
      owner = options.ownerKey ?? currentOwner();
    const presentation: EvidencePresentation = {
      id: `presentation_${crypto.randomUUID()}`,
      startedAt: clock(),
      priorExposure: {},
      valid: false,
      interrupted: false
    };
    current = presentation;
    presentations.set(presentation.id, presentation);
    active = true;
    // Silencing and AudioContext unlock happen synchronously on the initiating gesture.
    const stopped = base.stop({ notify: false });
    const prepared = base.prepare?.() ?? Promise.resolve();
    void prepared.catch(() => {});
    void enqueue(async () => {
      await stopped;
      await close('stopped');
      const id = `open_${presentation.id}`;
      const outsidePlan =
        options.knownCharacters && characters.some((ch) => !options.knownCharacters!.includes(ch));
      const guard = record(id, 'exposure-open', {
        session_id: outsidePlan ? null : (options.sessionId ?? null),
        presentation_id: presentation.id,
        characters,
        source: outsidePlan ? 'reference' : options.source,
        started_at: presentation.startedAt
      });
      open = { id, owner, characters, presentation, guard };
      const history = await all(owner);
      presentation.priorExposure = Object.fromEntries(
        characters.map((ch) => [ch, priorExposure(history, ch, Date.now())])
      );
      await write(owner, [guard]);
      if (disposed || expected !== generation || currentOwner() !== owner) {
        presentation.interrupted = true;
        await close('stopped');
        return;
      }
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            prepared,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error('Audio preparation timed out')),
                options.prepareTimeoutMs ?? 10000
              );
            })
          ]);
        } finally {
          clearTimeout(timeout);
        }
        if (disposed || expected !== generation || currentOwner() !== owner) {
          presentation.interrupted = true;
          await close('stopped');
          return;
        }
        presentation.startedAt = clock();
        active = true;
        base.play(plan);
      } catch (error) {
        presentation.interrupted = true;
        await base.stop({ notify: false });
        await close('stopped');
        active = false;
        throw error;
      }
    });
  }
  async function stop(options: { notify?: boolean } = {}) {
    ++generation;
    const wasActive = active;
    active = false;
    if (current && wasActive) current.interrupted = true;
    const stopped = base.stop({ notify: false });
    await enqueue(async () => {
      await stopped;
      await close('stopped');
    });
    if (wasActive && options.notify !== false && !disposed) emit('ended');
  }
  const stopForOwnerChange = () => stop({ notify: false });
  return {
    play,
    prepare: () => base.prepare?.() ?? Promise.resolve(),
    pause: async () => {
      if (current && active) current.interrupted = true;
      await base.pause();
    },
    resume: () => base.resume(),
    stop,
    async dispose() {
      if (disposed) return;
      disposed = true;
      activeEngines.delete(stopForOwnerChange);
      await stop({ notify: false }).catch(() => {});
      unsubscribe();
      await base.dispose();
      listeners.clear();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    isActive: () => active || base.isActive(),
    isPaused: () => base.isPaused(),
    elapsed: () => base.elapsed(),
    presentation: (id) => (id ? (presentations.get(id) ?? null) : current),
    flush: () => queue
  };
}

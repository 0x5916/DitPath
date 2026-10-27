<script lang="ts">
  import SavedSessions from '#lib/components/learning/SavedSessions.svelte';
  import {
    loadCheckpoint,
    saveCheckpoint,
    removeCheckpoint,
    discardCheckpoint,
    claimSession,
    type CopyCheckpoint,
    type SessionCheckpoint
  } from '#lib/data/session-checkpoints.ts';
  let savedCopy = $state.raw<CopyCheckpoint | null>(null),
    restoreCopy = $state.raw<CopyCheckpoint | null>(null);
  let copyLoading = $state(true),
    copySaveError = $state(false),
    copyBlocked = $state(false),
    copyHasWork = $state(false);
  let checkpointQueue = Promise.resolve(),
    copyLoad = 0;
  let copyLease: (() => Promise<void>) | null = null;
  let lastCopyCheckpoint: CopyCheckpoint | null = null;
  async function loadSavedCopy() {
    const owner = getTrainingOwner(),
      version = ++copyLoad;
    copyLoading = true;
    copyBlocked = false;
    savedCopy = null;
    restoreCopy = null;
    copyHasWork = false;
    try {
      const release = copyLease;
      copyLease = null;
      await release?.();
      const c = await loadCheckpoint(owner, 'copy');
      if (destroyed || owner !== getTrainingOwner() || version !== copyLoad) return;
      if (c?.kind === 'copy') savedCopy = c;
      else {
        const release = await claimSession(owner, 'copy');
        if (destroyed || owner !== getTrainingOwner() || version !== copyLoad) {
          await release();
          return;
        }
        copyLease = release;
      }
      copySaveError = false;
    } catch {
      if (owner === getTrainingOwner()) {
        copySaveError = true;
        copyBlocked = true;
      }
    } finally {
      if (owner === getTrainingOwner() && version === copyLoad) copyLoading = false;
    }
  }
  async function discardSavedCopy(entry: SessionCheckpoint) {
    const owner = getTrainingOwner();
    try {
      await discardCheckpoint(owner, entry);
      if (owner === getTrainingOwner()) {
        await loadSavedCopy();
      }
    } catch {
      if (owner === getTrainingOwner()) copySaveError = true;
    }
  }
  async function continueSavedCopy(entry: SessionCheckpoint) {
    if (entry.kind !== 'copy') return;
    const owner = getTrainingOwner();
    copyLoading = true;
    try {
      const release = await claimSession(owner, 'copy', true);
      if (destroyed || owner !== getTrainingOwner()) {
        await release();
        return;
      }
      copyLease = release;
      restoreCopy = entry;
      savedCopy = null;
      copySaveError = false;
      copyBlocked = false;
    } catch {
      if (owner === getTrainingOwner()) {
        copySaveError = true;
        copyBlocked = true;
      }
    } finally {
      if (owner === getTrainingOwner()) copyLoading = false;
    }
  }
  function retryCopyCheckpoint() {
    const owner = getTrainingOwner(),
      value = lastCopyCheckpoint;
    checkpointQueue = checkpointQueue
      .then(() => (value ? saveCheckpoint(owner, value) : removeCheckpoint(owner, 'copy')))
      .then(() => {
        if (owner === getTrainingOwner()) copySaveError = false;
      })
      .catch(() => {
        if (owner === getTrainingOwner()) copySaveError = true;
      });
  }

  function checkpointCopy(attempt: CopyAttempt, draft: string) {
    if (!attempt.id || !attempt.exercise.text) return;
    const owner = getTrainingOwner();
    if (attempt.session.status === 'ready' && !copyHasWork) return;
    const clear = attempt.session.status === 'ready';
    copyHasWork = !clear;
    const value: CopyCheckpoint = {
      version: 1,
      kind: 'copy',
      id: 'copy',
      href: '/morse/practice',
      savedAt: new Date().toISOString(),
      attempt: JSON.parse(JSON.stringify(attempt)),
      draft
    };
    lastCopyCheckpoint = clear ? null : value;
    checkpointQueue = checkpointQueue
      .then(() => (clear ? removeCheckpoint(owner, 'copy') : saveCheckpoint(owner, value)))
      .then(() => {
        if (owner === getTrainingOwner()) copySaveError = false;
      })
      .catch(() => {
        if (owner === getTrainingOwner()) copySaveError = true;
      });
  }
  async function saveCopyAndLeave() {
    practice?.prepareToLeave();
    await tick();
    await checkpointQueue;
    if (copySaveError) return;
    bypassDestination = new URL(localizedHref('/'), page.url.href).href;
    await goto(bypassDestination);
  }

  import { onDestroy, onMount, tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { createPracticeDeparture } from '#lib/practice/departure.ts';
  import ExitSessionDialog from '#lib/components/learning/ExitSessionDialog.svelte';
  import { readClientCwSettings, readStoredLesson } from '#lib/cwSync.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import InfoTip from '#lib/components/InfoTip.svelte';
  import ContinuousCopyPractice from '#lib/components/practice/ContinuousCopyPractice.svelte';
  import { closeTrainingDb, openTrainingDb } from '#lib/data/training-db.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import { createPracticeSessionRecord, type CopyAttempt } from '#lib/practice/copy-attempt.ts';
  import type { TrainingSessionRecord } from '#lib/training/v2/types.ts';
  import * as m from '#lib/paraglide/messages.js';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync
  } from '#lib/training-sync.svelte.ts';

  let practice = $state<{
    hasUnfinishedCopy: () => boolean;
    prepareToLeave: () => void;
    focusCopy: () => void;
  } | null>(null);
  let departure = $state.raw<ReturnType<typeof createPracticeDeparture> | null>(null);
  let returnFocus = $state<HTMLElement | null>(null);
  let navigationError = $state(false);
  let confirming = false;
  let bypassDestination: string | null = null;
  let allowUnload = false;
  let destroyed = false;
  let cancelHistoryRestore: (() => void) | null = null;

  let defaults = $state({ lesson: 1, charWpm: 20, effWpm: 12, freq: 600, startDelay: 0.5 });
  function loadDefaults() {
    const cw = readClientCwSettings();
    defaults = {
      lesson: readStoredLesson(LESSONS.length),
      charWpm: cw.char_wpm,
      effWpm: cw.eff_wpm,
      freq: cw.freq,
      startDelay: cw.start_delay
    };
  }

  let persistenceStatus = $state<'saving' | 'saved' | 'failed' | null>(null);
  let pendingRecord: TrainingSessionRecord | null = null;
  let attemptOwner: string | null = null;
  let recordOwner: string | null = null;
  let practiceOwner = $state('unclaimed');
  const unsavedRecords = new SvelteMap<string, TrainingSessionRecord>();

  function recordPractice(attempt: CopyAttempt) {
    if (attemptOwner === null || attemptOwner !== getTrainingOwner()) return;
    recordOwner = attemptOwner;
    pendingRecord = createPracticeSessionRecord(attempt, attempt.id ?? crypto.randomUUID());
    if (pendingRecord) {
      unsavedRecords.set(recordOwner, pendingRecord);
      void savePractice();
    }
  }

  async function savePractice() {
    if (!pendingRecord || persistenceStatus === 'saving') return;
    const record = pendingRecord;
    const owner = recordOwner ?? getTrainingOwner();
    persistenceStatus = 'saving';
    let db: IDBDatabase | null = null;
    try {
      db = await openTrainingDb();
      await createSessionRepository(db, owner).saveSession(record);
      await tick();
      await checkpointQueue;
      const checkpoint = await loadCheckpoint(owner, 'copy');
      if (checkpoint?.kind === 'copy' && checkpoint.attempt.id === record.id)
        await removeCheckpoint(owner, 'copy');
      if (unsavedRecords.get(owner) === record) unsavedRecords.delete(owner);
      if (owner === getTrainingOwner() && pendingRecord === record) {
        pendingRecord = null;
        persistenceStatus = 'saved';
      }
    } catch (error) {
      console.error('Failed to save practice history:', error);
      if (owner === getTrainingOwner() && pendingRecord === record) persistenceStatus = 'failed';
    } finally {
      if (db) closeTrainingDb(db);
    }
  }

  function hasWorkAtRisk() {
    return unsavedRecords.size > 0 || Boolean(practice?.hasUnfinishedCopy());
  }

  function waitForHistoryRestore(source: string): Promise<void> {
    if (window.location.href === source) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        window.removeEventListener('popstate', onPop);
        cancelHistoryRestore = null;
        resolve();
      };
      const onPop = () => {
        if (window.location.href === source) finish();
      };
      cancelHistoryRestore = finish;
      window.addEventListener('popstate', onPop);
    });
  }

  beforeNavigate((navigation) => {
    if (allowUnload || navigation.to?.url.href === bypassDestination) {
      bypassDestination = null;
      return;
    }
    if (!hasWorkAtRisk()) return;
    if (!navigation.to) {
      navigation.cancel();
      return;
    }
    const source = navigation.from?.url ?? page.url;
    const target = navigation.to.url;
    if (source.pathname === target.pathname && source.search === target.search) return;
    navigation.cancel();
    if (departure) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    practice?.prepareToLeave();
    const owner = getTrainingOwner();
    const delta = navigation.type === 'popstate' ? navigation.delta : null;
    navigationError = false;
    departure = createPracticeDeparture(
      delta === null ? Promise.resolve() : waitForHistoryRestore(source.href),
      () => {
        bypassDestination = target.href;
        if (delta !== null) window.history.go(delta);
        else if (navigation.willUnload) {
          allowUnload = true;
          window.location.assign(target.href);
        } else return goto(target.href);
      },
      () => !destroyed && owner === getTrainingOwner()
    );
  });

  async function cancelDeparture() {
    departure?.cancel();
    departure = null;
    cancelHistoryRestore?.();
    navigationError = false;
    await tick();
    if (!returnFocus?.isConnected) practice?.focusCopy();
  }

  async function confirmDeparture() {
    if (!departure || confirming) return;
    confirming = true;
    navigationError = false;
    try {
      await checkpointQueue;
      await removeCheckpoint(getTrainingOwner(), 'copy');
      if (await departure.confirm()) departure = null;
    } catch {
      bypassDestination = null;
      allowUnload = false;
      navigationError = true;
    } finally {
      confirming = false;
    }
  }

  afterNavigate(() => {
    bypassDestination = null;
    allowUnload = false;
  });
  onDestroy(() => {
    destroyed = true;
    const release = copyLease;
    copyLease = null;
    void checkpointQueue.finally(() => release?.());
    departure?.cancel();
    cancelHistoryRestore?.();
  });

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!allowUnload && hasWorkAtRisk()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // Keep existing character-explorer bookmarks useful after giving the tool its own page.
  onMount(() => {
    loadDefaults();
    void loadSavedCopy();
    const unsubscribe = subscribeTrainingSync(() => {
      const owner = getTrainingOwner();
      if (practiceOwner === owner) return;
      void cancelDeparture();
      practiceOwner = owner;
      void loadSavedCopy();
      loadDefaults();
      attemptOwner = null;
      recordOwner = owner;
      pendingRecord = unsavedRecords.get(owner) ?? null;
      persistenceStatus = pendingRecord ? 'failed' : null;
    });
    if (page.url.searchParams.get('mode') === 'familiarize') {
      void goto(localizedHref('/morse'), { replace: true });
    }
    return unsubscribe;
  });
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

<svelte:head>
  <title>{m.nav_practice()} · OpenCW</title>
</svelte:head>

<div class="page-narrow">
  <header class="practice-header">
    <h1 class="page-title">{m.nav_practice()}</h1>
    <InfoTip
      label={m.common_tip_label({ topic: m.nav_practice() })}
      text={m.practice_mastery_notice()}
    />
  </header>

  <TrainingSyncStatus
    owner={trainingSyncState.owner}
    pending={trainingSyncState.pending}
    error={trainingSyncState.error}
    syncing={trainingSyncState.syncing}
    synced={trainingSyncState.synced}
  />
  {#if copySaveError}<p role="alert">{m.session_save_error()}</p>
    <button
      class="btn-ghost"
      onclick={() => (copyBlocked ? void loadSavedCopy() : retryCopyCheckpoint())}
      >{m.common_retry()}</button
    >{/if}
  {#if copyLoading}<p role="status">{m.common_loading()}</p>
  {:else if copyBlocked}<p role="alert">{m.session_resume_error()}</p>
  {:else if savedCopy}<SavedSessions
      entries={[savedCopy]}
      onContinue={(entry) => void continueSavedCopy(entry)}
      onDiscard={(entry) => void discardSavedCopy(entry)}
    />
  {:else}
    {#if copyHasWork}<button class="btn-ghost" onclick={() => void saveCopyAndLeave()}
        >{m.session_save_leave()}</button
      >{/if}
    {#key practiceOwner}
      <ContinuousCopyPractice
        resume={restoreCopy}
        onCheckpoint={checkpointCopy}
        bind:this={practice}
        {...defaults}
        onFinish={() => void goto(localizedHref('/'))}
        onStart={() => {
          attemptOwner ??= getTrainingOwner();
        }}
        onReview={recordPractice}
        {persistenceStatus}
        onRetrySave={() => void savePractice()}
      />
    {/key}
  {/if}
</div>

<ExitSessionDialog
  isOpen={departure !== null}
  title={m.practice_leave_title()}
  description={navigationError
    ? m.practice_navigation_error()
    : unsavedRecords.size > 0
      ? m.lesson_save_discard_hint()
      : m.practice_leave_description()}
  confirmLabel={unsavedRecords.size > 0 ? m.lesson_leave_unsaved() : m.practice_discard_leave()}
  cancelLabel={unsavedRecords.size > 0 ? m.practice_keep_result() : m.practice_keep_copy()}
  returnFocusTo={returnFocus}
  onCancel={() => void cancelDeparture()}
  onConfirm={() => void confirmDeparture()}
/>

<style>
  .practice-header {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--block-gap);
  }
</style>

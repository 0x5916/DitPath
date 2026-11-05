<script lang="ts">
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, onMount, tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import ContinuousCopyPractice from '#lib/components/practice/ContinuousCopyPractice.svelte';
  import ExitSessionDialog from '#lib/components/learning/ExitSessionDialog.svelte';
  import InfoTip from '#lib/components/InfoTip.svelte';
  import SavedSessions from '#lib/components/learning/SavedSessions.svelte';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import { readClientCwSettings, readStoredLesson } from '#lib/cwSync.ts';
  import { createSessionRepository } from '#lib/data/session-repository.ts';
  import { closeTrainingDb, openTrainingDb } from '#lib/data/training-db.ts';
  import { waitForHistoryRestore, type HistoryRestore } from '#lib/history-restore.ts';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { createPracticeSessionRecord, type CopyAttempt } from '#lib/practice/copy-attempt.ts';
  import { createCopyCheckpointStore } from '#lib/practice/copy-checkpoint.svelte.ts';
  import { createPracticeDeparture } from '#lib/practice/departure.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import type { TrainingSessionRecord } from '#lib/training/v2/types.ts';
  import {
    getTrainingOwner,
    subscribeTrainingSync,
    trainingSyncState
  } from '#lib/training-sync.svelte.ts';

  let practice = $state<{
    hasUnfinishedCopy: () => boolean;
    prepareToLeave: () => void;
    focusCopy: () => void;
  } | null>(null);
  const copyStore = createCopyCheckpointStore();

  let departure = $state.raw<ReturnType<typeof createPracticeDeparture> | null>(null);
  let returnFocus = $state<HTMLElement | null>(null);
  let navigationError = $state(false);
  let confirming = false;
  let bypassDestination: string | null = null;
  let allowUnload = false;
  let destroyed = false;
  let historyRestore: HistoryRestore | null = null;

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

  async function saveCopyAndLeave() {
    practice?.prepareToLeave();
    await tick();
    await copyStore.whenIdle();
    if (copyStore.saveError) return;
    bypassDestination = new URL(localizedHref('/'), page.url.href).href;
    await goto(bypassDestination);
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
      await copyStore.clearForAttempt(record.id);
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
    const restore = delta === null ? null : waitForHistoryRestore(source.href);
    historyRestore = restore;
    departure = createPracticeDeparture(
      restore?.promise ?? Promise.resolve(),
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
    historyRestore?.cancel();
    historyRestore = null;
    navigationError = false;
    await tick();
    if (!returnFocus?.isConnected) practice?.focusCopy();
  }

  async function confirmDeparture() {
    if (!departure || confirming) return;
    confirming = true;
    navigationError = false;
    try {
      await copyStore.clear();
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
    void copyStore.dispose();
    departure?.cancel();
    historyRestore?.cancel();
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
    void copyStore.load();
    const unsubscribe = subscribeTrainingSync(() => {
      const owner = getTrainingOwner();
      if (practiceOwner === owner) return;
      void cancelDeparture();
      practiceOwner = owner;
      void copyStore.load();
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

<div class="practice-page">
  <header class="practice-header">
    <h1 class="page-title">{m.nav_practice()}</h1>
    <InfoTip
      heading
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
  {#if copyStore.blocked}<p role="alert">{m.session_resume_error()}</p>
    <button class="btn-ghost" onclick={() => void copyStore.load()}>{m.common_retry()}</button>
  {:else if copyStore.saveError}<p role="alert">{m.session_save_error()}</p>
    <button class="btn-ghost" onclick={() => copyStore.retry()}>{m.common_retry()}</button>
  {/if}
  {#if copyStore.loading}<p role="status">{m.common_loading()}</p>
  {:else if copyStore.saved && !copyStore.blocked}<SavedSessions
      entries={[copyStore.saved]}
      onContinue={(entry) => void copyStore.resume(entry)}
      onDiscard={(entry) => void copyStore.discard(entry)}
    />
  {:else if !copyStore.blocked}
    {#if copyStore.hasWork}<button class="btn-ghost" onclick={() => void saveCopyAndLeave()}
        >{m.session_save_leave()}</button
      >{/if}
    {#key practiceOwner}
      <ContinuousCopyPractice
        resume={copyStore.restore}
        onCheckpoint={copyStore.checkpoint}
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
    gap: 2px;
    margin-bottom: var(--space-8);
    --tip-trigger-size: 48px;
  }
  .practice-page {
    max-width: 40.625rem;
    margin-inline: auto;
  }
  .practice-header h1 {
    margin: 0;
    font-size: 2rem;
    line-height: 1.3;
  }
  .practice-page :global(.saved-sessions) {
    padding: var(--space-6);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
  }
  @media (min-width: 960px) {
    .practice-header h1 {
      font-size: 2.5rem;
    }
  }
</style>

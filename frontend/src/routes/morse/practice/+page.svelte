<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import MorseSectionNav from '#lib/components/MorseSectionNav.svelte';
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
  } from '#lib/training-sync.ts';

  let persistenceStatus = $state<'saving' | 'saved' | 'failed' | null>(null);
  let pendingRecord: TrainingSessionRecord | null = null;
  let attemptOwner: string | null = null;
  let recordOwner: string | null = null;
  let practiceOwner = $state('unclaimed');
  const unsavedRecords = new SvelteMap<string, TrainingSessionRecord>();

  function recordPractice(attempt: CopyAttempt) {
    if (attemptOwner === null || attemptOwner !== getTrainingOwner()) return;
    recordOwner = attemptOwner;
    pendingRecord = createPracticeSessionRecord(attempt, crypto.randomUUID());
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

  beforeNavigate((navigation) => {
    if (unsavedRecords.size === 0) return;
    if (navigation.willUnload || !window.confirm(m.lesson_save_discard_hint())) navigation.cancel();
  });

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (unsavedRecords.size > 0) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // Keep existing character-explorer bookmarks useful after giving the tool its own page.
  onMount(() => {
    const unsubscribe = subscribeTrainingSync(() => {
      const owner = getTrainingOwner();
      if (practiceOwner === owner) return;
      practiceOwner = owner;
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
  <title>{m.nav_practice()} · DitPath</title>
</svelte:head>

<div class="page-narrow">
  <MorseSectionNav current="practice" />
  <header class="practice-header">
    <h1 class="page-title">{m.nav_practice()}</h1>
    <p class="body-text">{m.practice_hub_subtitle()}</p>
    <p class="practice-notice">{m.practice_mastery_notice()}</p>
  </header>

  <TrainingSyncStatus
    owner={trainingSyncState.owner}
    pending={trainingSyncState.pending}
    error={trainingSyncState.error}
    syncing={trainingSyncState.syncing}
    synced={trainingSyncState.synced}
  />
  {#key practiceOwner}
    <ContinuousCopyPractice
      onStart={() => {
        attemptOwner ??= getTrainingOwner();
      }}
      onReview={recordPractice}
      {persistenceStatus}
      onRetrySave={() => void savePractice()}
    />
  {/key}
</div>

<style>
  .practice-header .body-text {
    margin: var(--space-2) 0 0;
  }

  .practice-notice {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { localizedHref } from '$lib/i18n.svelte';
  import { LESSONS } from '$lib/training/sequence';
  import { openTrainingDb } from '$lib/data/training-db';
  import { createAttemptRepository } from '$lib/data/attempt-repository';
  import { createSessionRepository } from '$lib/data/session-repository';
  import { reduceCharacterMasteries } from '$lib/training/v2/mastery';
  import type { CharacterMastery, ConfusionPair } from '$lib/training/v2/types';
  import CharacterMasteryGrid from '$lib/components/progress/CharacterMasteryGrid.svelte';
  import ConfusionList from '$lib/components/progress/ConfusionList.svelte';
  import PracticeActivity from '$lib/components/progress/PracticeActivity.svelte';

  let loading = $state(true);
  let masteryMap = $state<Map<string, CharacterMastery>>(new Map());
  let confusionPairs = $state<ConfusionPair[]>([]);
  let slowChars = $state<string[]>([]);
  let sessionCount7Days = $state(0);
  let totalMinutes7Days = $state(0);
  let averageAccuracy = $state(0);

  onMount(async () => {
    try {
      const db = await openTrainingDb();
      const attemptRepo = createAttemptRepository(db);
      const sessionRepo = createSessionRepository(db);

      const now = Date.now();
      const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
      const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString();
      const nowIso = new Date(now).toISOString();

      const allAttempts = await attemptRepo.getAttemptsByTimeRange(sixtyDaysAgo, nowIso);
      const attempts7Days = allAttempts.filter((a) => a.createdAt >= sevenDaysAgo);

      // Compute 7-day stats
      const scored7Days = attempts7Days.filter((a) => a.classification !== 'unmeasured');
      const correct7Days = scored7Days.filter((a) => a.isCorrect).length;
      averageAccuracy =
        scored7Days.length > 0 ? Math.round((correct7Days / scored7Days.length) * 100) : 0;

      const sessions = await sessionRepo.getSessions(50);
      const recentSessions = sessions.filter(
        (s) => s.status === 'completed' && s.startedAt >= sevenDaysAgo
      );
      sessionCount7Days = recentSessions.length;
      totalMinutes7Days = sessionCount7Days * 4; // approximately 4 min per session

      // Character masteries
      const map = new SvelteMap(
        reduceCharacterMasteries(LESSONS.join('').split(''), allAttempts, { nowIso })
      );
      const slow: string[] = [];
      for (const [ch, charMastery] of map) {
        if (
          charMastery.medianLatencyMs !== null &&
          charMastery.medianLatencyMs > 2000 &&
          charMastery.totalAttempts >= 3
        ) {
          slow.push(ch);
        }
      }

      // Compute acoustic confusion pairs
      const pairCounts = new SvelteMap<
        string,
        { expected: string; actual: string; count: number; last: string }
      >();
      for (const a of allAttempts) {
        if (!a.isCorrect && a.enteredText.length === 1 && a.targetCharacter.length === 1) {
          const key = `${a.targetCharacter}_${a.enteredText}`;
          const existing = pairCounts.get(key);
          if (existing) {
            existing.count += 1;
            existing.last = a.createdAt;
          } else {
            pairCounts.set(key, {
              expected: a.targetCharacter,
              actual: a.enteredText,
              count: 1,
              last: a.createdAt
            });
          }
        }
      }

      const pairs: ConfusionPair[] = Array.from(pairCounts.values())
        .filter((p) => p.count >= 2)
        .map((p) => ({
          expected: p.expected,
          actual: p.actual,
          confusionCount: p.count,
          lastOccurredAt: p.last
        }))
        .sort((a, b) => b.confusionCount - a.confusionCount);

      masteryMap = map;
      confusionPairs = pairs;
      slowChars = slow;
      loading = false;
    } catch (err) {
      console.error('Failed to load progress data:', err);
      loading = false;
    }
  });

  function handleStartReview() {
    void goto(localizedHref('/morse/learn'));
  }
</script>

<svelte:head>
  <title>Progress & Mastery · DitPath</title>
</svelte:head>

<div class="page-content page-narrow">
  <div class="progress-container">
    <header class="progress-header">
      <div class="eyebrow">Progress</div>
      <h1 class="page-title">Your Recognition Evidence</h1>
      <p class="progress-subtitle">
        Concrete automaticity and retention metrics across all trained symbols.
      </p>
    </header>

    {#if loading}
      <div class="skeleton loading-card"></div>
    {:else}
      <PracticeActivity
        sessionCount={sessionCount7Days}
        totalMinutes={totalMinutes7Days}
        accuracyPercent={averageAccuracy}
      />

      <section class="progress-section" aria-labelledby="mastery-heading">
        <h2 id="mastery-heading" class="section-title">Character Mastery</h2>
        <CharacterMasteryGrid {masteryMap} />
      </section>

      <section class="progress-section" aria-labelledby="diagnostics-heading">
        <h2 id="diagnostics-heading" class="section-title">Diagnostics</h2>
        <ConfusionList {confusionPairs} {slowChars} onStartReview={handleStartReview} />
      </section>
    {/if}
  </div>
</div>

<style>
  .progress-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    margin: 0 auto;
  }

  .progress-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .eyebrow {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--learning-current, var(--accent));
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .progress-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    max-width: 28rem;
    line-height: var(--leading-normal);
  }

  .progress-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .section-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
  }

  .loading-card {
    height: 16rem;
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }
</style>

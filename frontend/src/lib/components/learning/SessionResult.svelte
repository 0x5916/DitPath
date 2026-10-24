<script lang="ts">
  import type { SessionSummary } from '../../training/v2/types';
  import { CheckCircle2, RotateCcw, AlertCircle, LoaderCircle } from '@lucide/svelte';
  import type { SessionPersistenceStatus } from '../../training/v2/session-controller.svelte';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    summary: SessionSummary;
    persistenceStatus: SessionPersistenceStatus;
    busy?: boolean;
    onNextLesson?: () => void;
    onRepeatLesson?: () => void;
    onFinish: () => void;
  }

  let {
    summary,
    persistenceStatus,
    busy = false,
    onNextLesson = () => {},
    onRepeatLesson = () => {},
    onFinish = () => {}
  }: Props = $props();

  let accuracyPercent = $derived(Math.round(summary.accuracy * 100));
  let latencySec = $derived(
    summary.medianLatencyMs !== null
      ? m.lesson_result_seconds({ seconds: (summary.medianLatencyMs / 1000).toFixed(1) })
      : m.lesson_result_insufficient()
  );
</script>

<div class="result-card" role="region" aria-label={m.lesson_result_label()}>
  <div class="result-header">
    <div class="result-badge">
      <CheckCircle2 size={24} class="result-icon" />
      <h2 class="result-title">{m.lesson_result_title()}</h2>
    </div>
    {#if summary.unlockedNextStep}
      <p class="result-subtitle text-good">
        {m.lesson_result_unlocked()}
      </p>
    {:else if summary.weakCharacters.length > 0}
      <p class="result-subtitle">
        {m.lesson_result_weak({ characters: summary.weakCharacters.join(', ') })}
      </p>
    {:else}
      <p class="result-subtitle">{m.lesson_result_continue()}</p>
    {/if}
  </div>

  <div class="metrics-grid">
    <div class="metric-item">
      <span class="metric-label">{m.lesson_result_accuracy()}</span>
      <span class="metric-val">{accuracyPercent}%</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">{m.lesson_result_latency()}</span>
      <span class="metric-val">{latencySec}</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">{m.lesson_result_replays()}</span>
      <span class="metric-val">{summary.totalReplays}</span>
    </div>
  </div>

  {#if summary.weakCharacters.length > 0}
    <div class="weak-section">
      <span class="weak-label">{m.lesson_result_weak_label()}</span>
      <div class="weak-chips">
        {#each summary.weakCharacters as ch (ch)}
          <span class="weak-chip">{ch}</span>
        {/each}
      </div>
    </div>
  {/if}

  <div class="result-actions">
    {#if summary.unlockedNextStep}
      <button
        type="button"
        class="btn-primary"
        disabled={busy || persistenceStatus === 'saving'}
        onclick={onNextLesson}>{m.lesson_result_next()}</button
      >
    {:else}
      <button
        type="button"
        class="btn-primary"
        disabled={busy || persistenceStatus === 'saving'}
        onclick={onRepeatLesson}
      >
        <RotateCcw size={16} />
        <span>{m.lesson_result_repeat()}</span>
      </button>
    {/if}

    <button
      type="button"
      class="btn-ghost"
      disabled={busy || persistenceStatus === 'saving'}
      onclick={onFinish}>{m.lesson_result_finish()}</button
    >
  </div>

  <footer class="result-footer" role="status">
    {#if persistenceStatus === 'saved'}
      <CheckCircle2 size={16} aria-hidden="true" /><span>{m.lesson_saved()}</span>
    {:else if persistenceStatus === 'saving'}
      <LoaderCircle size={16} aria-hidden="true" /><span>{m.lesson_saving()}</span>
    {:else}
      <AlertCircle size={16} aria-hidden="true" /><span>{m.lesson_save_failed()}</span>
    {/if}
  </footer>
</div>

<style>
  .result-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 28rem;
    box-shadow: var(--shadow-overlay);
  }

  .result-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
  }

  .result-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--learning-stable);
  }

  .result-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .result-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .text-good {
    color: var(--learning-stable);
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-4) var(--space-2);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .metric-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    text-align: center;
  }

  .metric-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .metric-val {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .weak-section {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .weak-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-1);
  }

  .weak-chip {
    padding: 0.1rem 0.4rem;
    font-family: var(--font-mono);
    font-weight: 700;
    border-radius: var(--radius-xs);
    background-color: var(--status-bad-tint);
    color: var(--learning-error);
  }

  .result-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: 18rem;
  }

  .result-footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  @media (max-width: 479px) {
    .metrics-grid {
      grid-template-columns: 1fr;
    }

    .metric-item {
      flex-direction: row;
      justify-content: space-between;
      gap: var(--space-3);
      text-align: start;
    }

    .metric-val {
      flex-shrink: 0;
      max-width: 50%;
      text-align: end;
    }

    .metric-label {
      min-width: 0;
      overflow-wrap: anywhere;
      text-transform: none;
      letter-spacing: normal;
    }
  }
</style>

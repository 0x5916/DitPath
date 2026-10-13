<script lang="ts">
  import type { SessionSummary } from '../../training/v2/types';
  import { CheckCircle2, RotateCcw } from '@lucide/svelte';

  interface Props {
    summary: SessionSummary;
    onNextLesson?: () => void;
    onRepeatLesson?: () => void;
    onFinish: () => void;
  }

  let {
    summary,
    onNextLesson = () => {},
    onRepeatLesson = () => {},
    onFinish = () => {}
  }: Props = $props();

  let accuracyPercent = $derived(Math.round(summary.accuracy * 100));
  let latencySec = $derived(
    summary.medianLatencyMs !== null
      ? (summary.medianLatencyMs / 1000).toFixed(1) + ' s'
      : 'Not enough data'
  );
</script>

<div class="result-card" role="region" aria-label="Session Results">
  <div class="result-header">
    <div class="result-badge">
      <CheckCircle2 size={24} class="result-icon" />
      <h2 class="result-title">Session Complete</h2>
    </div>
    {#if summary.unlockedNextStep}
      <p class="result-subtitle text-good">
        You are ready to add the next character to your course path.
      </p>
    {:else if summary.weakCharacters.length > 0}
      <p class="result-subtitle">
        Good practice! {summary.weakCharacters.join(', ')} still needs a bit more automaticity.
      </p>
    {:else}
      <p class="result-subtitle">Good practice! Continue building your sound recognition.</p>
    {/if}
  </div>

  <div class="metrics-grid">
    <div class="metric-item">
      <span class="metric-label">Accuracy</span>
      <span class="metric-val">{accuracyPercent}%</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">Median recognition</span>
      <span class="metric-val">{latencySec}</span>
    </div>
    <div class="metric-item">
      <span class="metric-label">Replays</span>
      <span class="metric-val">{summary.totalReplays}</span>
    </div>
  </div>

  {#if summary.weakCharacters.length > 0}
    <div class="weak-section">
      <span class="weak-label">Needs another look:</span>
      <div class="weak-chips">
        {#each summary.weakCharacters as ch (ch)}
          <span class="weak-chip">{ch}</span>
        {/each}
      </div>
    </div>
  {/if}

  <div class="result-actions">
    {#if summary.unlockedNextStep}
      <button type="button" class="btn-primary" onclick={onNextLesson}> Start next lesson </button>
    {:else}
      <button type="button" class="btn-primary" onclick={onRepeatLesson}>
        <RotateCcw size={16} />
        <span>Practise again</span>
      </button>
    {/if}

    <button type="button" class="btn-ghost" onclick={onFinish}> Finish for today </button>
  </div>

  <footer class="result-footer">
    <span class="sync-note">Saved on this device</span>
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
    color: var(--learning-stable, var(--status-good));
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
    color: var(--learning-stable, var(--status-good));
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
  }

  .weak-section {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .weak-chips {
    display: flex;
    gap: var(--space-1);
  }

  .weak-chip {
    padding: 0.1rem 0.4rem;
    font-family: var(--font-mono);
    font-weight: 700;
    border-radius: var(--radius-xs);
    background-color: var(--status-bad-tint);
    color: var(--learning-error, var(--status-bad));
  }

  .result-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: 18rem;
  }

  .result-footer {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .sync-note {
    opacity: 0.8;
  }
</style>

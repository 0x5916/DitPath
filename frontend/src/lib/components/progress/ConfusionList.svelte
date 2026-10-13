<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import type { ConfusionPair } from '../../training/v2/types';
  import { RotateCcw, AlertTriangle } from '@lucide/svelte';

  interface Props {
    confusionPairs: ConfusionPair[];
    slowChars: string[];
    onStartReview?: (characters: string[]) => void;
  }

  let { confusionPairs = [], slowChars = [], onStartReview = () => {} }: Props = $props();

  let hasItems = $derived(confusionPairs.length > 0 || slowChars.length > 0);

  function handleReviewAll() {
    const chars = new SvelteSet<string>();
    for (const p of confusionPairs) {
      chars.add(p.expected);
      chars.add(p.actual);
    }
    for (const c of slowChars) {
      chars.add(c);
    }
    onStartReview(Array.from(chars));
  }
</script>

<div class="confusion-card" role="region" aria-label="Acoustic confusion diagnostics">
  <div class="card-head">
    <div class="head-title-row">
      <span class="text-ok">
        <AlertTriangle size={18} />
      </span>
      <h3 class="card-title">Needs Attention</h3>
    </div>
    <p class="card-desc">
      Characters with recurring acoustic confusions or slower recognition latencies.
    </p>
  </div>

  {#if !hasItems}
    <p class="clean-note">No recurring confusion patterns detected. Great listening!</p>
  {:else}
    <div class="diagnostic-lists">
      {#if confusionPairs.length > 0}
        <div class="sub-list">
          <span class="sub-list-title">Acoustic confusions:</span>
          <div class="pair-rows">
            {#each confusionPairs as pair (`${pair.expected}-${pair.actual}`)}
              <div class="pair-row">
                <span class="pair-symbols">{pair.expected} ↔ {pair.actual}</span>
                <span class="pair-count">{pair.confusionCount} confusions</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if slowChars.length > 0}
        <div class="sub-list">
          <span class="sub-list-title">Slow recognition (>2.0s):</span>
          <div class="slow-chips">
            {#each slowChars as ch (ch)}
              <span class="slow-chip">{ch}</span>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="card-action">
      <button type="button" class="btn-primary review-btn" onclick={handleReviewAll}>
        <RotateCcw size={16} />
        <span>Review weak characters</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .confusion-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .card-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .head-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .text-ok {
    color: var(--learning-review, var(--status-ok));
  }

  .card-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .clean-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .diagnostic-lists {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-2) 0;
  }

  .sub-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .sub-list-title {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
  }

  .pair-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .pair-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    background-color: var(--bg-inset);
    border-radius: var(--radius-xs);
    font-size: var(--text-sm);
  }

  .pair-symbols {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--text-primary);
  }

  .pair-count {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .slow-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .slow-chip {
    padding: 0.15rem 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
    background-color: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
  }

  .card-action {
    display: flex;
    justify-content: flex-start;
    margin-top: var(--space-2);
  }

  .review-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>

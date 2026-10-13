<script lang="ts">
  import { LESSONS } from '../../training/sequence';
  import CharacterMasteryCell from './CharacterMasteryCell.svelte';
  import type { CharacterMastery } from '../../training/v2/types';

  interface Props {
    masteryMap: Map<string, CharacterMastery>;
    onSelectChar?: (char: string) => void;
  }

  let { masteryMap, onSelectChar = () => {} }: Props = $props();

  // All 40 Koch characters in sequence order
  const allChars = LESSONS.join('').split('');

  let stableChars = $derived(allChars.filter((c) => masteryMap.get(c)?.status === 'stable'));
  let learningChars = $derived(allChars.filter((c) => masteryMap.get(c)?.status === 'learning'));
  let reviewChars = $derived(allChars.filter((c) => masteryMap.get(c)?.status === 'review'));
  let newChars = $derived(
    allChars.filter((c) => !masteryMap.has(c) || masteryMap.get(c)?.status === 'new')
  );
</script>

<div class="mastery-grid-card" role="region" aria-label="Character mastery breakdown">
  <div class="grid-section">
    <div class="section-title-row">
      <span class="status-dot dot-stable"></span>
      <h3 class="group-title">Stable ({stableChars.length})</h3>
    </div>
    {#if stableChars.length > 0}
      <div class="cells-row">
        {#each stableChars as c (c)}
          <CharacterMasteryCell
            character={c}
            mastery={masteryMap.get(c)}
            onclick={() => onSelectChar(c)}
          />
        {/each}
      </div>
    {:else}
      <p class="empty-note">Complete multi-session practice to stabilize symbols.</p>
    {/if}
  </div>

  <div class="grid-section">
    <div class="section-title-row">
      <span class="status-dot dot-learning"></span>
      <h3 class="group-title">Developing ({learningChars.length})</h3>
    </div>
    {#if learningChars.length > 0}
      <div class="cells-row">
        {#each learningChars as c (c)}
          <CharacterMasteryCell
            character={c}
            mastery={masteryMap.get(c)}
            onclick={() => onSelectChar(c)}
          />
        {/each}
      </div>
    {:else}
      <p class="empty-note">Symbols currently under practice appear here.</p>
    {/if}
  </div>

  {#if reviewChars.length > 0}
    <div class="grid-section">
      <div class="section-title-row">
        <span class="status-dot dot-review"></span>
        <h3 class="group-title">Review due ({reviewChars.length})</h3>
      </div>
      <div class="cells-row">
        {#each reviewChars as c (c)}
          <CharacterMasteryCell
            character={c}
            mastery={masteryMap.get(c)}
            onclick={() => onSelectChar(c)}
          />
        {/each}
      </div>
    </div>
  {/if}

  <div class="grid-section">
    <div class="section-title-row">
      <span class="status-dot dot-new"></span>
      <h3 class="group-title">New / Upcoming ({newChars.length})</h3>
    </div>
    <div class="cells-row">
      {#each newChars as c (c)}
        <CharacterMasteryCell
          character={c}
          mastery={masteryMap.get(c)}
          onclick={() => onSelectChar(c)}
        />
      {/each}
    </div>
  </div>
</div>

<style>
  .mastery-grid-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .grid-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .dot-stable {
    background-color: var(--learning-stable, var(--status-good));
  }

  .dot-learning {
    background-color: var(--learning-current, var(--accent));
  }

  .dot-review {
    background-color: var(--learning-review, var(--status-ok));
  }

  .dot-new {
    background-color: var(--text-muted);
  }

  .group-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .cells-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .empty-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>

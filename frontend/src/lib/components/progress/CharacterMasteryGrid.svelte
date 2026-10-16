<script lang="ts">
  import { LESSONS } from '../../training/sequence';
  import CharacterMasteryCell from './CharacterMasteryCell.svelte';
  import type { CharacterMastery, MasteryStatus } from '../../training/v2/types';
  import * as m from '#lib/paraglide/messages.js';

  let { masteryMap }: { masteryMap: ReadonlyMap<string, CharacterMastery> } = $props();
  const allChars = LESSONS.join('').split('');
  let groups = $derived(
    [
      { status: 'stable', label: m.learn_status_stable(), empty: m.progress_stable_empty() },
      {
        status: 'learning',
        label: m.progress_status_learning(),
        empty: m.progress_learning_empty()
      },
      { status: 'review', label: m.learn_status_review(), empty: '' },
      { status: 'new', label: m.progress_status_new(), empty: '' }
    ].map((group) => ({
      ...group,
      characters: allChars.filter(
        (character) =>
          (masteryMap.get(character)?.status ?? 'new') === (group.status as MasteryStatus)
      )
    }))
  );
</script>

<div class="mastery-grid-card" role="region" aria-label={m.progress_mastery_label()}>
  {#each groups as group (group.status)}
    {#if group.characters.length > 0 || group.empty}
      <div class="grid-section">
        <div class="section-title-row">
          <span class="status-dot dot-{group.status}" aria-hidden="true"></span>
          <h3 class="group-title">
            {m.progress_group_count({ status: group.label, count: group.characters.length })}
          </h3>
        </div>
        {#if group.characters.length > 0}
          <div class="cells-row">
            {#each group.characters as character (character)}
              <CharacterMasteryCell {character} mastery={masteryMap.get(character)} />
            {/each}
          </div>
        {:else}
          <p class="empty-note">{group.empty}</p>
        {/if}
      </div>
    {/if}
  {/each}
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

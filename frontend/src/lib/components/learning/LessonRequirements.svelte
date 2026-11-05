<script lang="ts">
  import { CircleAlert } from '@lucide/svelte';
  import type { CharacterMastery } from '../../training/v2/types';
  import { masteryRequirements } from './lesson-requirements';
  import * as m from '#lib/paraglide/messages.js';

  let {
    unlockTitle,
    checks
  }: {
    unlockTitle: string;
    checks: { character: string; mastery: CharacterMastery }[];
  } = $props();
</script>

<details class="unlock-checks">
  <summary>{unlockTitle}</summary>
  <p class="unlock-hint">{m.learn_unlock_checks_hint()}</p>
  <ul class="mastery-checks" role="list">
    {#each checks as { character, mastery } (character)}
      <li class="mastery-character">
        <strong class="check-character">{character}</strong>
        <div class="character-checks">
          {#each masteryRequirements(mastery) as requirement (requirement.id)}
            {#if requirement.id === 'review'}
              <p class="review-check">
                <CircleAlert size={16} aria-hidden="true" />{requirement.label}
              </p>
            {:else}
              <div class="mastery-check">
                <div class="check-values">
                  <span>{requirement.label}</span><strong>{requirement.value}</strong>
                </div>
                {#if requirement.current !== undefined && requirement.target !== undefined}
                  <progress aria-hidden="true" value={requirement.current} max={requirement.target}
                  ></progress>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </li>
    {/each}
  </ul>
</details>

<style>
  .unlock-checks summary {
    min-height: var(--answer-target-min);
    padding-block: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
  }

  .unlock-checks summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .unlock-hint {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .mastery-checks {
    display: grid;
    gap: var(--space-6);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .mastery-character {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
  }

  .check-character {
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .character-checks {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .check-values {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    overflow-wrap: anywhere;
  }

  .check-values strong {
    color: var(--text-primary);
    font-weight: 500;
  }

  .mastery-check progress {
    appearance: none;
    display: block;
    width: 100%;
    height: var(--space-1);
    margin-top: var(--space-2);
    border: 0;
    background: var(--border);
  }

  .mastery-check progress::-webkit-progress-bar {
    background: var(--border);
  }

  .mastery-check progress::-webkit-progress-value {
    background: var(--accent);
  }

  .mastery-check progress::-moz-progress-bar {
    background: var(--accent);
  }

  .review-check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
  }

  .review-check :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-1);
  }
</style>

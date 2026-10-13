<script lang="ts">
  import { LESSONS } from '../../training/sequence';
  import CoursePathItem, { type PathItemStatus } from './CoursePathItem.svelte';
  import type { CharacterMastery } from '../../training/v2/types';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    currentStep: number;
    masteryMap?: Map<string, CharacterMastery>;
    suggestedStep?: number;
    onSelectStep: (step: number) => void;
  }

  let {
    currentStep = 1,
    masteryMap = new Map(),
    suggestedStep,
    onSelectStep = () => {}
  }: Props = $props();

  let nearbyStart = $derived(Math.max(1, currentStep - 1));
  let nearbyEnd = $derived(Math.min(LESSONS.length, currentStep + 2));

  function getItemStatus(step: number, chars: string): PathItemStatus {
    if (step > currentStep) {
      if (suggestedStep && step <= suggestedStep) {
        return 'legacy-unverified';
      }
      return 'locked';
    }

    if (step === currentStep) {
      return 'current';
    }

    // Check if any character introduced at this step is due for review
    const charList = chars.split('');
    const anyReviewDue = charList.some((c) => masteryMap.get(c)?.status === 'review');
    if (anyReviewDue) return 'review';

    const allStable = charList.every((c) => masteryMap.get(c)?.status === 'stable');
    if (allStable) return 'stable';

    return 'available';
  }
</script>

{#snippet lessons(start: number, end: number)}
  <ol class="lesson-list" {start} role="list">
    {#each LESSONS.slice(start - 1, end) as chars, idx (start + idx)}
      {@const stepNum = start + idx}
      <li>
        <CoursePathItem
          step={stepNum}
          characters={chars}
          status={getItemStatus(stepNum, chars)}
          isCurrent={stepNum === currentStep}
          onSelect={() => onSelectStep(stepNum)}
        />
      </li>
    {/each}
  </ol>
{/snippet}

<div class="course-path">
  {#if nearbyStart > 1}
    <details class="path-disclosure">
      <summary>{m.learn_path_earlier({ count: nearbyStart - 1 })}</summary>
      {@render lessons(1, nearbyStart - 1)}
    </details>
  {/if}

  {@render lessons(nearbyStart, nearbyEnd)}

  {#if nearbyEnd < LESSONS.length}
    <details class="path-disclosure">
      <summary>{m.learn_path_upcoming({ count: LESSONS.length - nearbyEnd })}</summary>
      {@render lessons(nearbyEnd + 1, LESSONS.length)}
    </details>
  {/if}
</div>

<style>
  .course-path {
    width: 100%;
  }

  .lesson-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .path-disclosure {
    margin-block: var(--space-2);
  }

  summary {
    min-height: var(--answer-target-min);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  summary:hover {
    background-color: var(--bg-inset);
    color: var(--text-primary);
  }

  details[open] > summary {
    margin-bottom: var(--space-2);
  }

  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>

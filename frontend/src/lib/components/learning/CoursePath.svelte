<script lang="ts">
  import type { Snippet } from 'svelte';
  import { LESSONS } from '../../training/sequence';
  import CoursePathItem, { type PathItemStatus } from './CoursePathItem.svelte';
  import type { CharacterMastery } from '../../training/v2/types';
  import { deriveCoursePathItemStatus } from '../../training/v2/course-guidance';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    currentStep: number;
    /** Highest lesson whose unlock history is recorded; never decreased by review. */
    unlockedStep?: number;
    current: Snippet;
    requirements?: Snippet;
    ready?: boolean;
    masteryMap?: Map<string, CharacterMastery>;
    suggestedStep?: number;
    onSelectStep: (step: number) => void;
  }

  let {
    currentStep = 1,
    unlockedStep = currentStep,
    current,
    requirements,
    ready = true,
    masteryMap = new Map(),
    suggestedStep,
    onSelectStep = () => {}
  }: Props = $props();

  let expanded = $state(false);
  let nearbyStart = $derived(Math.max(1, Math.min(currentStep - 1, LESSONS.length - 2)));

  function getItemStatus(step: number, chars: string): PathItemStatus {
    return deriveCoursePathItemStatus(step, chars, {
      currentStep,
      unlockedStep,
      masteryMap,
      suggestedStep
    });
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

<section class="course-path" aria-label={m.learn_next_recommendation()}>
  <div class="path-panel">
    <div class="current-content">{@render current()}</div>
    {#if requirements}{@render requirements()}{/if}
  </div>
  {#if ready}
    <section class="path-browse" aria-labelledby="course-heading">
      <h2 id="course-heading">{m.lessons_course_heading()}</h2>
      {#if !expanded}{@render lessons(nearbyStart, nearbyStart + 2)}{/if}
      <details bind:open={expanded}>
        <summary>{m.lessons_browse_all({ count: LESSONS.length })}</summary>
        {@render lessons(1, LESSONS.length)}
      </details>
    </section>
  {/if}
</section>

<style>
  .course-path {
    display: grid;
    gap: var(--space-10);
    align-items: start;
  }
  .path-panel {
    padding: var(--space-6);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    min-width: 0;
  }
  .current-content {
    display: grid;
    gap: var(--space-6);
  }
  .path-browse {
    min-width: 0;
  }
  h2 {
    margin: 0 0 var(--space-6);
    font-size: var(--text-xl);
  }
  .lesson-list {
    display: grid;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  summary {
    min-height: var(--answer-target-min);
    padding-block: var(--space-3);
    margin-top: var(--space-4);
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
  }
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  details[open] > summary {
    margin-bottom: var(--space-4);
  }
  @media (min-width: 960px) {
    .course-path {
      grid-template-columns: minmax(0, 650fr) minmax(0, 422fr);
      gap: 3rem;
    }
  }
</style>

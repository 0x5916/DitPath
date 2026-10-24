<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ArrowRight, CheckCircle2, AlertCircle, Circle } from '@lucide/svelte';
  import { LESSONS } from '../../training/sequence';
  import CoursePathItem, { type PathItemStatus } from './CoursePathItem.svelte';
  import type { CharacterMastery } from '../../training/v2/types';
  import * as m from '#lib/paraglide/messages.js';

  interface Props {
    currentStep: number;
    current: Snippet;
    requirements?: Snippet;
    displayStep?: number;
    ready?: boolean;
    showPrevious?: boolean;
    masteryMap?: Map<string, CharacterMastery>;
    suggestedStep?: number;
    onSelectStep: (step: number) => void;
  }

  let {
    currentStep = 1,
    current,
    requirements,
    displayStep = currentStep,
    ready = true,
    showPrevious = true,
    masteryMap = new Map(),
    suggestedStep,
    onSelectStep = () => {}
  }: Props = $props();

  let previousStep = $derived(ready && showPrevious && currentStep > 1 ? currentStep - 1 : 0);
  let earlierEnd = $derived(previousStep ? previousStep - 1 : displayStep - 1);
  let previousCharacters = $derived((LESSONS[previousStep - 1] ?? '').split('').join(', '));
  let previousStatus = $derived(
    previousStep ? getItemStatus(previousStep, LESSONS[previousStep - 1]) : 'available'
  );
  let previousLabel = $derived(
    previousStatus === 'stable'
      ? m.learn_status_stable()
      : previousStatus === 'review'
        ? m.learn_status_review()
        : m.learn_status_available()
  );

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

<section class="course-path" aria-label={m.learn_path_title()}>
  <div class="path-panel">
    <div class={['lesson-track', previousStep > 0 && 'has-previous']}>
      {#if previousStep > 0}
        <button
          type="button"
          class="previous-lesson"
          aria-label={m.learn_path_lesson_label({
            step: previousStep,
            characters: previousCharacters,
            status: previousLabel
          })}
          onclick={() => onSelectStep(previousStep)}
        >
          <span class="previous-character" aria-hidden="true">{previousCharacters}</span>
          <span class="previous-copy">
            <span class="previous-step">{m.learn_path_lesson({ step: previousStep })}</span>
            <span class="previous-status status-{previousStatus}">
              {#if previousStatus === 'stable'}
                <CheckCircle2 size={16} aria-hidden="true" />
              {:else if previousStatus === 'review'}
                <AlertCircle size={16} aria-hidden="true" />
              {:else}
                <Circle size={16} aria-hidden="true" />
              {/if}
              {previousLabel}
            </span>
          </span>
        </button>
        <div class="connector" aria-hidden="true"><ArrowRight size={24} /></div>
      {/if}
      <div class="current-lesson">
        {@render current()}
        {#if requirements}{@render requirements()}{/if}
      </div>
    </div>
  </div>

  {#if ready && (earlierEnd > 0 || displayStep < LESSONS.length)}
    <div class="path-browse">
      {#if earlierEnd > 0}
        <details class="path-disclosure">
          <summary>{m.learn_path_earlier({ count: earlierEnd })}</summary>
          {@render lessons(1, earlierEnd)}
        </details>
      {/if}
      {#if displayStep < LESSONS.length}
        <details class="path-disclosure">
          <summary>
            {displayStep === currentStep
              ? m.learn_path_upcoming({ count: LESSONS.length - displayStep })
              : m.learn_path_other({ count: LESSONS.length - displayStep })}
          </summary>
          {@render lessons(displayStep + 1, LESSONS.length)}
        </details>
      {/if}
    </div>
  {/if}
</section>

<style>
  .course-path {
    width: 100%;
  }

  .path-panel {
    padding: var(--space-5);
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
  }

  .lesson-track {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
  }

  .previous-lesson {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    min-height: 48px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    text-align: start;
    cursor: pointer;
  }

  .previous-lesson:hover {
    background: var(--bg-inset);
  }

  .previous-character {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    background: var(--bg-inset);
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .previous-copy {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .previous-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .previous-status :global(svg) {
    flex-shrink: 0;
  }

  .status-stable {
    color: var(--learning-stable);
  }

  .status-review {
    color: var(--learning-review);
  }

  .connector {
    display: grid;
    place-items: center;
    width: 48px;
    height: 32px;
    color: var(--text-muted);
  }

  .connector :global(svg) {
    transform: rotate(90deg);
  }

  .current-lesson {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .path-browse {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-4);
  }

  .lesson-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
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

  summary:focus-visible,
  .previous-lesson:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (min-width: 640px) {
    .path-panel {
      padding: var(--space-6);
    }

    .lesson-track.has-previous {
      grid-template-columns: minmax(0, 0.8fr) 32px minmax(0, 1.3fr);
      column-gap: var(--space-4);
    }

    .connector {
      width: 32px;
      height: 48px;
    }

    .connector :global(svg) {
      transform: none;
    }
  }
</style>

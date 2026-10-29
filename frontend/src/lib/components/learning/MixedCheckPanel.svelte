<script lang="ts">
  import LearningOverview from './LearningOverview.svelte';
  import type { LearningSnapshot } from '../../data/learning-snapshot';
  import type { Snippet } from 'svelte';
  import type { MixedCheckSession } from '../../training/learning-policy/mixed-plan';
  import type { EvaluatedCheck } from '../../training/learning-policy/types';
  import * as m from '#lib/paraglide/messages.js';
  let {
    plan,
    result = null,
    snapshot = null,
    busy = false,
    storageStatus,
    onRepeatCheck,
    onFinish
  }: {
    plan: MixedCheckSession;
    result?: EvaluatedCheck | null;
    snapshot?: LearningSnapshot | null;
    busy?: boolean;
    storageStatus?: Snippet;
    onRepeatCheck?: () => void;
    onFinish: () => void;
  } = $props();
</script>

<section class="mixed-panel">
  <h1 tabindex="-1" {@attach (heading) => heading.focus()}>
    {result && !result.complete ? m.mixed_incomplete() : m.mixed_results()}
  </h1>
  <p>{m.learning_overview_profile({ speed: plan.plan.profile.charWpm })}</p>
  {#if result}
    <ul>
      {#each plan.plan.targets as character (character)}<li>
          {m.mixed_count({
            character,
            correct: result.targets[character]?.unassistedCorrect ?? 0,
            total: result.targets[character]?.eligible ?? 0
          })}
        </li>{/each}
    </ul>
    {#if !result.complete}<p role="status">{m.mixed_invalid()}</p>{/if}
  {/if}
  {#if storageStatus}{@render storageStatus()}{/if}
  <p>{m.mixed_criteria()}</p>
  <p>{m.mixed_gap_hint()}</p>
  {#if snapshot && !busy}<LearningOverview {snapshot} compact onAction={onRepeatCheck} />{/if}
  <button
    class={snapshot ? 'btn-ghost' : 'btn-primary'}
    type="button"
    disabled={busy}
    onclick={onFinish}>{m.lesson_result_finish()}</button
  >
</section>

<style>
  .mixed-panel {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
    width: 100%;
    max-width: 34rem;
    text-align: left;
  }
  h1 {
    font-size: var(--text-2xl);
    margin: 0;
  }
  h1:focus {
    outline: none;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  ul {
    margin: 0;
    padding-left: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  button {
    min-height: 3rem;
  }
</style>

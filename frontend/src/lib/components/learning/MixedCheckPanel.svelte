<script lang="ts">
  import LearningOverview from './LearningOverview.svelte';
  import type { LearningSnapshot } from '../../data/learning-snapshot';
  import type { Snippet } from 'svelte';
  import type { MixedCheckSession } from '../../training/learning-policy/mixed-plan';
  import type { EvaluatedCheck } from '../../training/learning-policy/types';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  let {
    plan,
    result = null,
    snapshot = null,
    finished = false,
    busy = false,
    storageStatus,
    onStart,
    onRepeatCheck,
    onFinish
  }: {
    plan: MixedCheckSession;
    result?: EvaluatedCheck | null;
    snapshot?: LearningSnapshot | null;
    finished?: boolean;
    busy?: boolean;
    storageStatus?: Snippet;
    onStart: () => void;
    onRepeatCheck?: () => void;
    onFinish: () => void;
  } = $props();
</script>

<section class="mixed-panel">
  <h1 tabindex="-1" {@attach (heading) => heading.focus()}>
    {finished
      ? result && !result.complete
        ? m.mixed_incomplete()
        : m.mixed_results()
      : m.mixed_targets({ characters: plan.plan.targets.join(', ') })}
  </h1>
  <p>{m.learning_overview_profile({ speed: plan.plan.profile.charWpm })}</p>
  {#if finished}
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
  {:else}
    <p>{m.mixed_setup({ count: plan.prompts.length })}</p>
    <p>{m.mixed_support_hint()}</p>
    <p>{m.mixed_gap_hint()}</p>
    <button class="btn-primary" type="button" disabled={busy} onclick={onStart}
      >{m.mixed_start()}</button
    >
    <a class="link" href={localizedHref('/morse/progress')}>{m.nav_progress()}</a>
  {/if}
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
  button,
  a {
    min-height: 3rem;
  }
  a {
    display: flex;
    align-items: center;
  }
</style>

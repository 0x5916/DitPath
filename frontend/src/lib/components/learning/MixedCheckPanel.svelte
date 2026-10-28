<script lang="ts">
  import LearningOverview from './LearningOverview.svelte';
  import type { LearningSnapshot } from '../../data/learning-snapshot';
  import { onMount, type Snippet } from 'svelte';
  import type { MixedCheckSession } from '../../training/learning-policy/mixed-plan';
  import type { EvaluatedCheck } from '../../training/learning-policy/types';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  let {
    plan,
    autoStart = false,
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
    autoStart?: boolean;
    result?: EvaluatedCheck | null;
    snapshot?: LearningSnapshot | null;
    finished?: boolean;
    busy?: boolean;
    storageStatus?: Snippet;
    onStart: () => void;
    onRepeatCheck?: () => void;
    onFinish: () => void;
  } = $props();
  let countdown = $state<number | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;
  function cancelStart() {
    clearInterval(timer);
    countdown = null;
  }
  function beginStart() {
    if (busy || countdown !== null || document.hidden) return;
    countdown = 3;
    timer = setInterval(() => {
      if (document.hidden) return cancelStart();
      if (countdown !== null && countdown > 1) countdown--;
      else {
        cancelStart();
        onStart();
      }
    }, 1000);
  }
  onMount(() => {
    if (autoStart && !finished) beginStart();
    return cancelStart;
  });
</script>

<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) cancelStart();
  }}
/>

<section class="mixed-panel" class:counting={countdown !== null}>
  <h1 tabindex="-1" {@attach (heading) => heading.focus()}>
    {countdown !== null
      ? m.check_ready_title()
      : finished
        ? result && !result.complete
          ? m.mixed_incomplete()
          : m.mixed_results()
        : m.mixed_targets({ characters: plan.plan.targets.join(', ') })}
  </h1>
  {#if finished}<p>{m.learning_overview_profile({ speed: plan.plan.profile.charWpm })}</p>{/if}
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
    <p>{m.check_entry_facts({ count: plan.prompts.length, speed: plan.plan.profile.charWpm })}</p>
    {#if countdown !== null}
      <p class="ready-count" role="status" aria-label={m.check_get_ready({ count: countdown })}>
        {countdown}
      </p>
      <button class="btn-ghost" type="button" onclick={cancelStart}
        >{m.learning_import_cancel()}</button
      >
    {:else}
      <button class="btn-primary" type="button" disabled={busy} onclick={beginStart}
        >{m.mixed_start()}</button
      >
      <details class="ui-disclosure">
        <summary>{m.check_how()}</summary>
        <p>{m.mixed_setup({ count: plan.prompts.length })}</p>
        <p>{m.mixed_support_hint()}</p>
        <p>{m.mixed_gap_hint()}</p>
      </details>
    {/if}
    <a class="link" href={localizedHref('/morse/progress')}>{m.nav_progress()}</a>
  {/if}
</section>

<style>
  .ready-count {
    font-size: 4rem;
    color: var(--accent);
    width: 100%;
    text-align: center;
    padding-block: var(--space-8);
  }
  details p {
    margin-top: var(--space-3);
  }
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

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ReviewPlan } from '../../training/targeted-review';
  import { summarizeReview } from '../../training/targeted-review';
  import type { AttemptEvent } from '../../training/v2/types';
  import type { SessionPersistenceStatus } from '../../training/v2/session-controller.svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  let {
    plan,
    attempts = null,
    status = 'saved',
    busy = false,
    round = 0,
    storageStatus,
    onStart,
    onRepeat,
    onFinish
  }: {
    plan: ReviewPlan;
    attempts?: AttemptEvent[] | null;
    status?: SessionPersistenceStatus;
    busy?: boolean;
    round?: number;
    storageStatus?: Snippet;
    onStart: () => void;
    onRepeat: () => void;
    onFinish: () => void;
  } = $props();
  const screening = $derived(plan.purpose === 'return-screening');
  const result = $derived(attempts ? summarizeReview(attempts) : null);
</script>

<section class="review-panel" aria-labelledby="review-title">
  <header>
    <h1
      id="review-title"
      tabindex="-1"
      {@attach (heading) => {
        heading.focus();
      }}
    >
      {result
        ? m.review_result_title()
        : screening
          ? m.review_return_title()
          : m.review_title({ characters: plan.targets.join(', ') })}
    </h1>
    {#if !result && screening}<p>{m.review_return_hint()}</p>{/if}
  </header>
  {#if result}
    <p>{m.review_answer_count({ count: result.answered })}</p>
    <dl>
      <div>
        <dt>{m.review_first_listen()}</dt>
        <dd>{result.firstListen}</dd>
      </div>
      <div>
        <dt>{m.review_after_replay()}</dt>
        <dd>{result.afterReplay}</dd>
      </div>
      <div>
        <dt>{m.review_not_correct()}</dt>
        <dd>{result.notCorrect}</dd>
      </div>
    </dl>
    {#if screening}<p>{m.review_screening_result()}</p>{/if}
    {#if storageStatus}{@render storageStatus()}{/if}
  {:else}
    <p>{m.review_setup_hint({ count: plan.prompts.length })}</p>
    <p class="conditions">
      {m.review_conditions({
        speed: plan.prompts[0].spec.charWpm,
        tone: plan.prompts[0].spec.freqHz
      })}
    </p>
  {/if}
  <p class="supporting">{m.review_unmeasured()}</p>

  {#if result && round >= 1}<p>{m.review_break_hint()}</p>{/if}
  <div class="actions">
    {#if result}
      <button
        type="button"
        class="btn-primary"
        disabled={busy || status === 'saving'}
        onclick={onFinish}>{m.lesson_result_finish()}</button
      >
      {#if round < 1}<button
          type="button"
          class="btn-ghost"
          disabled={busy || status !== 'saved'}
          onclick={onRepeat}>{m.review_repeat()}</button
        >{/if}
    {:else}
      <button type="button" class="btn-primary" disabled={busy} onclick={onStart}
        >{m.review_start()}</button
      >
    {/if}
    {#if !result || status === 'saved'}
      <a class="btn-ghost" href={localizedHref('/morse/practice')}>{m.nav_practice()}</a>
      <a class="link" href={localizedHref('/morse/learn')}>{m.home_all_lessons()}</a>
    {/if}
  </div>
</section>

<style>
  .review-panel {
    width: 100%;
    max-width: 34rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    text-align: left;
  }
  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
  }
  h1:focus {
    outline: none;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  header p {
    margin-top: var(--space-3);
  }
  .conditions,
  .supporting {
    font-size: var(--text-sm);
  }
  dl {
    margin: 0;
    display: grid;
    gap: var(--space-4);
  }
  dl div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }
  dt {
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xl);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .actions > * {
    min-height: var(--answer-target-min);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
</style>

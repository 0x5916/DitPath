<script lang="ts">
  import { Play, RotateCcw, AlertCircle } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';
  import { LESSONS } from '#lib/training/sequence.ts';

  export type HeroStateKind =
    'new' | 'next' | 'review-due' | 'resume' | 'complete' | 'loading' | 'error';

  interface Props {
    kind: HeroStateKind;
    step?: number;
    introducedChar?: string;
    reviewChars?: string[];
    resumableSessionId?: string;
    errorMessage?: string;
    sessionActionPending?: boolean;
    embedded?: boolean;
    onStart: (step: number) => void;
    onResume?: (sessionId: string) => void;
    onDiscardResume?: () => void;
  }

  let {
    kind = 'new',
    step = 1,
    introducedChar = 'KM',
    reviewChars = [],
    resumableSessionId,
    errorMessage = '',
    sessionActionPending = false,
    embedded = false,
    onStart = () => {},
    onResume = () => {},
    onDiscardResume = () => {}
  }: Props = $props();
</script>

{#snippet activeHeading(heading: string, characters: string, status: string)}
  <div class="hero-heading">
    <span class="hero-character">{characters.split('').join(', ')}</span>
    <div class="hero-heading-copy">
      <h2 class="hero-title">{heading}</h2>
      {#if status}
        <p class={['hero-status', kind === 'review-due' && 'is-review']}>{status}</p>
      {/if}
    </div>
  </div>
{/snippet}

<div
  class={['learn-hero-card', embedded && 'is-embedded']}
  role="region"
  aria-label={m.learn_next_recommendation()}
  aria-busy={kind === 'loading' || sessionActionPending}
>
  {#if kind === 'loading'}
    <span class="sr-only" role="status">{m.common_loading()}</span>
    <div class="skeleton hero-skeleton-eyebrow" aria-hidden="true"></div>
    <div class="skeleton hero-skeleton-title" aria-hidden="true"></div>
    <div class="skeleton hero-skeleton-desc" aria-hidden="true"></div>
    <div class="skeleton hero-skeleton-btn" aria-hidden="true"></div>
  {:else if kind === 'error'}
    <div class="hero-error" role="alert">
      <AlertCircle size={24} />
      <div>
        <h2 class="hero-title">{m.learn_data_error_title()}</h2>
        <p class="hero-desc">{errorMessage || m.learn_data_error_description()}</p>
      </div>
    </div>
  {:else if kind === 'resume' && resumableSessionId}
    {#if embedded}
      {@render activeHeading(m.learn_restart_title({ step }), introducedChar, '')}
    {:else}
      <h2 class="hero-title">{m.learn_restart_title({ step })}</h2>
    {/if}
    <p class="hero-desc">{m.learn_restart_description()}</p>
    <div class="hero-actions">
      <button
        type="button"
        class="btn-cta hero-btn"
        disabled={sessionActionPending}
        onclick={() => onResume(resumableSessionId)}
      >
        <Play size={18} />
        <span>{m.learn_restart_action()}</span>
      </button>
      <button
        type="button"
        class="btn-ghost"
        disabled={sessionActionPending}
        onclick={onDiscardResume}
      >
        {m.learn_dismiss_action()}
      </button>
    </div>
  {:else if kind === 'review-due'}
    {#if embedded}
      {@render activeHeading(
        m.learn_review_title({ characters: reviewChars.join(', ') }),
        introducedChar,
        m.learn_review_eyebrow()
      )}
    {:else}
      <div class="hero-eyebrow eyebrow-review">{m.learn_review_eyebrow()}</div>
      <h2 class="hero-title">{m.learn_review_title({ characters: reviewChars.join(', ') })}</h2>
    {/if}
    <p class="hero-desc">{m.learn_review_description()}</p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(step)}>
        <RotateCcw size={18} />
        <span>{m.learn_review_action({ step })}</span>
      </button>
    </div>
  {:else if kind === 'complete'}
    <div class="hero-eyebrow eyebrow-complete">{m.learn_complete_eyebrow()}</div>
    <h2 class="hero-title">{m.learn_complete_title()}</h2>
    <p class="hero-desc">{m.learn_complete_description({ count: LESSONS.join('').length })}</p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(LESSONS.length)}>
        <Play size={18} />
        <span>{m.learn_complete_action()}</span>
      </button>
    </div>
  {:else if kind === 'new'}
    {#if embedded}
      {@render activeHeading(m.learn_path_lesson({ step: 1 }), LESSONS[0], m.learn_ready_status())}
    {:else}
      <h2 class="hero-title">
        {m.home_lesson_title({ step: 1, characters: LESSONS[0].split('').join(', ') })}
      </h2>
    {/if}
    <p class="hero-desc">
      {m.learn_new_description()}
    </p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(1)}>
        <Play size={18} />
        <span>{m.learn_start_action({ step: 1 })}</span>
      </button>
    </div>
  {:else}
    <!-- kind === 'next' -->
    {#if embedded}
      {@render activeHeading(m.learn_path_lesson({ step }), introducedChar, m.learn_ready_status())}
    {:else}
      <h2 class="hero-title">
        {m.home_lesson_title({ step, characters: introducedChar.split('').join(', ') })}
      </h2>
    {/if}
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(step)}>
        <Play size={18} />
        <span>{m.learn_start_action({ step })}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .learn-hero-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-5);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-inline-start: 3px solid var(--accent);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow);
    position: relative;
  }

  .learn-hero-card.is-embedded {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .hero-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-width: 0;
    width: 100%;
  }

  .hero-character {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    min-width: var(--answer-target-min);
    min-height: var(--answer-target-min);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--bg-inset);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 600;
    line-height: 1;
  }

  .hero-heading-copy {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .hero-status {
    margin: 0;
    color: var(--learning-current);
    font-size: var(--text-sm);
  }

  .hero-status.is-review {
    color: var(--learning-review);
  }

  .hero-eyebrow {
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--learning-current);
  }

  .eyebrow-review {
    color: var(--learning-review);
  }

  .eyebrow-complete {
    color: var(--learning-stable);
  }

  .hero-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: var(--leading-tight);
  }

  .hero-desc {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .hero-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: 0;
  }

  .hero-btn {
    min-height: var(--answer-target-min);
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
  }

  .hero-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    color: var(--learning-error);
  }

  .skeleton {
    max-width: 100%;
  }

  .hero-skeleton-eyebrow {
    height: 0.8rem;
    width: 6rem;
  }

  .hero-skeleton-title {
    height: 1.75rem;
    width: 16rem;
  }

  .hero-skeleton-desc {
    height: 1rem;
    width: 22rem;
  }

  .hero-skeleton-btn {
    height: 3rem;
    width: 12rem;
    margin-top: var(--space-3);
  }
</style>

<script lang="ts">
  import { ArrowRight, Play, RotateCcw, AlertCircle } from '@lucide/svelte';
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
    onStart = () => {},
    onResume = () => {},
    onDiscardResume = () => {}
  }: Props = $props();
</script>

<div
  class="learn-hero-card"
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
    <h2 class="hero-title">{m.learn_restart_title({ step })}</h2>
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
    <div class="hero-eyebrow eyebrow-review">{m.learn_review_eyebrow()}</div>
    <h2 class="hero-title">{m.learn_review_title({ characters: reviewChars.join(', ') })}</h2>
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
    <div class="hero-eyebrow">{m.learn_new_eyebrow()}</div>
    <h2 class="hero-title">{m.learn_new_title({ characters: LESSONS[0].split('').join(', ') })}</h2>
    <p class="hero-desc">
      {m.learn_new_description()}
    </p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(1)}>
        <span>{m.learn_start_action({ step: 1 })}</span>
        <ArrowRight size={18} />
      </button>
    </div>
  {:else}
    <!-- kind === 'next' -->
    <div class="hero-eyebrow">{m.learn_next_eyebrow()}</div>
    <h2 class="hero-title">{m.learn_next_title({ step, characters: introducedChar })}</h2>
    <p class="hero-desc">
      {m.learn_next_description({ characters: introducedChar })}
    </p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(step)}>
        <span>{m.learn_start_action({ step })}</span>
        <ArrowRight size={18} />
      </button>
    </div>
  {/if}
</div>

<style>
  .learn-hero-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-6);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-inline-start: 3px solid var(--accent);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: var(--max-width-narrow);
    position: relative;
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
    font-size: var(--text-2xl);
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
    margin-top: var(--space-3);
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

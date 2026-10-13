<script lang="ts">
  import { ArrowRight, Play, RotateCcw, AlertCircle } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages';

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
        <h2 class="hero-title">Unable to load lesson data</h2>
        <p class="hero-desc">{errorMessage || 'Please refresh or check your local storage.'}</p>
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
    <div class="hero-eyebrow eyebrow-review">Needs attention</div>
    <h2 class="hero-title">Review {reviewChars.join(', ')}</h2>
    <p class="hero-desc">Strengthen sound automaticity before advancing along your Koch path.</p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(step)}>
        <RotateCcw size={18} />
        <span>Start review (~4 min)</span>
      </button>
    </div>
  {:else if kind === 'complete'}
    <div class="hero-eyebrow eyebrow-complete">Course complete</div>
    <h2 class="hero-title">Daily Mixed Review</h2>
    <p class="hero-desc">Maintain instant recognition across all 40 Morse characters.</p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(40)}>
        <Play size={18} />
        <span>Start daily review</span>
      </button>
    </div>
  {:else if kind === 'new'}
    <div class="hero-eyebrow">Begin here</div>
    <h2 class="hero-title">Lesson 1 · Learn K and M</h2>
    <p class="hero-desc">
      Listen for the musical rhythm and shape. 12 short prompts · about 4 min.
    </p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(1)}>
        <span>Start lesson 1</span>
        <ArrowRight size={18} />
      </button>
    </div>
  {:else}
    <!-- kind === 'next' -->
    <div class="hero-eyebrow">Next up</div>
    <h2 class="hero-title">Lesson {step} · Add {introducedChar}</h2>
    <p class="hero-desc">
      Review known symbols and train new sound {introducedChar}. About 4 min.
    </p>
    <div class="hero-actions">
      <button type="button" class="btn-cta hero-btn" onclick={() => onStart(step)}>
        <span>Start lesson {step}</span>
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
    max-width: var(--max-width-narrow, 46rem);
    position: relative;
  }

  .hero-eyebrow {
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--learning-current, var(--accent));
  }

  .eyebrow-review {
    color: var(--learning-review, var(--status-ok));
  }

  .eyebrow-complete {
    color: var(--learning-stable, var(--status-good));
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
    min-height: var(--answer-target-min, 3rem);
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
  }

  .hero-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    color: var(--learning-error, var(--status-bad));
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

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Check } from '@lucide/svelte';
  import { DEFAULT_MASTERY_POLICY, type SessionSummary } from '../../training/v2/types';
  import type { SessionPersistenceStatus } from '../../training/v2/session-controller.svelte';
  import { resultView } from './result-view';
  import InfoTip from '../InfoTip.svelte';
  import * as m from '#lib/paraglide/messages.js';

  let {
    summary,
    persistenceStatus,
    busy = false,
    onNextLesson,
    onRepeatLesson,
    onFinish,
    storageStatus
  }: {
    summary: SessionSummary;
    persistenceStatus: SessionPersistenceStatus;
    busy?: boolean;
    onNextLesson: () => void;
    onRepeatLesson: () => void;
    onFinish: () => void;
    storageStatus?: Snippet;
  } = $props();
  const view = $derived(resultView(summary));
  const disabled = $derived(busy || persistenceStatus === 'saving');
  const recommendation = $derived.by(() => {
    switch (view.reason) {
      case 'next':
        return m.lesson_result_unlocked({ step: view.nextStep!, characters: view.nextCharacters });
      case 'complete':
        return m.lesson_result_course_complete();
      case 'accuracy':
        return m.lesson_result_accuracy_hint({
          percent: Math.round(DEFAULT_MASTERY_POLICY.targetAccuracy * 100)
        });
      case 'characters':
        return m.lesson_result_weak({ characters: summary.weakCharacters.join(', ') });
      case 'attempts':
        return m.lesson_result_more_answers();
      case 'sessions':
        return m.lesson_result_more_sessions();
      default:
        return m.lesson_result_continue();
    }
  });
  function focusHeading(heading: HTMLElement) {
    heading.focus();
  }
</script>

<section class="result" aria-label={m.lesson_result_label()}>
  <header>
    <p class="lesson-label">
      {m.home_lesson_title({ step: summary.step, characters: view.lessonCharacters })}
    </p>
    <h1 tabindex="-1" {@attach focusHeading}>
      <Check size={28} aria-hidden="true" />
      {view.reason === 'complete' ? m.lesson_result_course_title() : m.lesson_result_title()}
    </h1>
  </header>

  <dl class="metrics">
    <div>
      <dt>{m.lesson_result_accuracy()}</dt>
      <dd class="value" class:unmeasured={view.accuracyPercent === null}>
        {view.accuracyPercent === null
          ? m.lesson_result_insufficient()
          : `${view.accuracyPercent}%`}
      </dd>
      {#if view.accuracyPercent !== null}<dd class="detail">
          {m.lesson_result_count({
            correct: summary.correctAttempts,
            total: summary.scoredAttempts
          })}
        </dd>{/if}
    </div>
    <div>
      <dt>
        {m.lesson_result_latency()}<InfoTip
          label={m.lesson_result_latency()}
          text={m.lesson_result_latency_hint()}
        />
      </dt>
      <dd class="value" class:unmeasured={view.latencySeconds === null}>
        {view.latencySeconds === null
          ? m.lesson_result_insufficient()
          : m.lesson_result_seconds({ seconds: view.latencySeconds })}
      </dd>
    </div>
    <div class="replays">
      <dt>
        {m.lesson_result_replays()}<InfoTip
          label={m.lesson_result_replays()}
          text={m.lesson_result_replays_hint()}
        />
      </dt>
      <dd>{summary.totalReplays}</dd>
    </div>
  </dl>

  <p class="recommendation">{recommendation}</p>
  <div class="storage">{@render storageStatus?.()}</div>

  <footer>
    <button
      type="button"
      class={persistenceStatus === 'failed' ? 'btn-ghost' : 'btn-primary'}
      {disabled}
      onclick={view.action === 'next'
        ? onNextLesson
        : view.action === 'finish'
          ? onFinish
          : onRepeatLesson}
    >
      {view.action === 'next'
        ? m.lesson_result_next()
        : view.action === 'finish'
          ? m.lesson_result_finish()
          : m.lesson_result_repeat()}
    </button>
    <button
      type="button"
      class="btn-ghost"
      {disabled}
      onclick={view.action === 'finish' ? onRepeatLesson : onFinish}
    >
      {view.action === 'finish' ? m.lesson_result_repeat() : m.lesson_result_finish()}
    </button>
  </footer>
</section>

<style>
  .lesson-label {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .result {
    width: 100%;
    max-width: 30rem;
    min-height: min(36rem, calc(100dvh - 8rem));
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-block: var(--space-4);
  }
  h1 {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 600;
    line-height: var(--leading-tight);
    overflow-wrap: anywhere;
  }
  h1:focus {
    outline: none;
  }
  h1 :global(svg) {
    color: var(--status-good);
    flex-shrink: 0;
  }
  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: 0;
    text-align: start;
  }
  .metrics > div {
    flex: 1 1 8rem;
    min-width: 0;
  }
  dt {
    display: flex;
    align-items: center;
    min-height: 44px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  dd {
    margin: 0;
  }
  .value {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .detail {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-top: var(--space-2);
  }
  .unmeasured {
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 400;
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  .metrics > .replays {
    flex-basis: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .replays dd {
    font-family: var(--font-mono);
  }
  .recommendation {
    margin: 0;
    padding: var(--space-4);
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    text-align: start;
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  .storage {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: auto;
  }
  footer button {
    width: 100%;
    min-height: 3.5rem;
    white-space: normal;
  }
</style>

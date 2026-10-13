<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { localizedHref } from '$lib/i18n.svelte';
  import { ArrowLeft, ChevronRight } from '@lucide/svelte';
  import PracticeModeCard from '$lib/components/practice/PracticeModeCard.svelte';
  import ContinuousCopyPractice from '$lib/components/practice/ContinuousCopyPractice.svelte';
  import FamiliarizationPractice from '$lib/components/practice/FamiliarizationPractice.svelte';
  import * as m from '$lib/paraglide/messages';

  let mode = $derived.by(() => {
    if (!browser) return null;
    return page.url.searchParams.get('mode');
  });

  let showQuickStart = $state(false);
  let quickStartOpen = $state(false);

  function dismissQuickStart() {
    showQuickStart = false;
  }
</script>

<svelte:head>
  <title>{m.trainer_title()} · DitPath</title>
</svelte:head>

<div class="page-content page-narrow">
  <div class="practice-hub-container">
    {#if mode === 'copy'}
      <div class="mode-header">
        <a href={localizedHref('/morse/practice')} class="btn-ghost back-btn">
          <ArrowLeft size={16} />
          <span>{m.trainer_back_to_workshop()}</span>
        </a>
      </div>
      <ContinuousCopyPractice />
    {:else if mode === 'familiarize'}
      <div class="mode-header">
        <a href={localizedHref('/morse/practice')} class="btn-ghost back-btn">
          <ArrowLeft size={16} />
          <span>{m.trainer_back_to_workshop()}</span>
        </a>
      </div>
      <FamiliarizationPractice
        onStartPassage={() => {
          if (browser) window.location.href = localizedHref('/morse/practice?mode=copy');
        }}
      />
    {:else}
      <div class="hub-header">
        <div class="eyebrow">{m.trainer_title()}</div>
        <h1 class="page-title">Train Your Way</h1>
        <p class="hub-subtitle">
          Choose a self-directed practice mode to hone specific listening and copying skills.
        </p>
      </div>

      {#if showQuickStart}
        <section class="quickstart" aria-labelledby="quickstart-title">
          <details class="quickstart-guide" bind:open={quickStartOpen}>
            <summary class="quickstart-summary">
              <ChevronRight size={16} aria-hidden="true" />
              <h2 id="quickstart-title" class="quickstart-title">{m.trainer_quickstart_title()}</h2>
            </summary>
            <ol class="quickstart-steps">
              <li>{m.trainer_quickstart_step1()}</li>
              <li>{m.trainer_quickstart_step2()}</li>
              <li>{m.trainer_quickstart_step3()}</li>
            </ol>
            <details class="quickstart-tips">
              <summary>{m.trainer_quickstart_tips()}</summary>
              <ul>
                <li>{m.trainer_quickstart_tip1()}</li>
                <li>{m.trainer_quickstart_tip2()}</li>
                <li>{m.trainer_quickstart_tip3()}</li>
              </ul>
            </details>
          </details>
          <button type="button" class="btn-ghost" onclick={dismissQuickStart}>
            {m.trainer_quickstart_start()}
          </button>
        </section>
      {/if}

      <fieldset class="segmented" aria-label={m.trainer_mode_legend()}>
        <legend class="sr-only">{m.trainer_mode_legend()}</legend>
      </fieldset>

      <div class="practice-cards-grid">
        <PracticeModeCard
          title={m.trainer_mode_passage()}
          description="Listen to a generated 60-second Morse passage and copy text in real time."
          actionLabel="Start copy practice"
          href={localizedHref('/morse/practice?mode=copy')}
        />

        <PracticeModeCard
          title={m.trainer_mode_drill()}
          description="See any symbol and its dot-dash pattern while listening to its tone rhythm."
          actionLabel="Inspect symbols"
          href={localizedHref('/morse/practice?mode=familiarize')}
        />
      </div>

      <div class="hub-footer-notice">
        <p class="notice-text">
          Free practice does not affect your guided course unlocks or mastery requirements.
        </p>
        <a href={localizedHref('/morse/learn')} class="btn-ghost back-to-course">
          <ArrowLeft size={16} />
          <span>Back to Koch Course</span>
        </a>
      </div>
    {/if}
  </div>
</div>

<style>
  .practice-hub-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    margin: 0 auto;
  }

  .hub-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .eyebrow {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--learning-current, var(--accent));
  }

  .page-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .hub-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    max-width: 28rem;
    line-height: var(--leading-normal);
  }

  .quickstart {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border-card);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .quickstart-guide {
    flex: 1 1 18rem;
    min-width: 0;
  }

  .quickstart-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    list-style: none;
    cursor: pointer;
  }

  .quickstart-summary::marker {
    content: '';
  }

  .quickstart-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .quickstart-steps {
    margin: var(--space-2) 0 0;
    padding-left: 1.15rem;
    list-style: decimal;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .quickstart-steps li + li {
    margin-top: 0.3rem;
  }

  .quickstart-tips {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .quickstart-tips summary {
    cursor: pointer;
    color: var(--accent);
  }

  .quickstart-tips ul {
    margin: var(--space-2) 0 0;
    padding-left: 1.15rem;
    list-style: disc;
  }

  .practice-cards-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
  }

  .mode-header {
    width: 100%;
    max-width: var(--max-width-narrow, 46rem);
    display: flex;
    justify-content: flex-start;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hub-footer-notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
  }

  .notice-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .back-to-course {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
</style>

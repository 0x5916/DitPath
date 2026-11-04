<script lang="ts">
  import { CircleAlert, CircleCheck, RotateCcw, ShieldCheck } from '@lucide/svelte';
  import type { LearningSnapshot } from '../../data/learning-snapshot';
  import { returnScreeningTargets } from '../../data/learning-snapshot';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  import { recallAction } from './recall-action';

  let {
    snapshot = null,
    failed = false,
    onRetry
  }: {
    snapshot?: LearningSnapshot | null;
    failed?: boolean;
    onRetry?: () => void;
  } = $props();

  const action = $derived(
    snapshot ? recallAction(snapshot.recommendation.primary, snapshot.knownCharacters) : null
  );
  const hasRecall = $derived(
    Boolean(snapshot && (snapshot.knownCharacters.length || snapshot.hasProspectiveEvidence))
  );
  const due = $derived(
    snapshot
      ? snapshot.characters.filter(
          (character) =>
            snapshot.knownCharacters.includes(character.character) && character.review?.ready
        )
      : []
  );
  const proficiency = $derived(
    snapshot?.characters.filter((character) => character.proficiency).length ?? 0
  );
  const retention = $derived(
    snapshot?.characters.filter((character) => character.retention).length ?? 0
  );
  const provisional = $derived(
    snapshot?.characters.filter(
      (character) =>
        character.proficiency?.status === 'provisional' ||
        character.retention?.status === 'provisional'
    ).length ?? 0
  );
  const screening = $derived(snapshot ? returnScreeningTargets(snapshot, null) : null);
  const screeningHref = $derived(
    screening?.length
      ? localizedHref(
          `/morse/learn/session?review=return&targets=${encodeURIComponent(screening.slice(0, 8).join(''))}`
        )
      : null
  );
</script>

<div class="page-narrow page-stack recall-page">
  <header class="recall-header">
    <h1 class="page-title">{m.review_page_title()}</h1>
    <p class="body-text">{m.review_page_intro()}</p>
    {#if snapshot}<p class="profile-note">
        {m.review_page_profile({ speed: snapshot.profile.charWpm })}
      </p>{/if}
  </header>

  {#if failed}
    <div class="recall-alert" role="alert">
      <CircleAlert size={24} aria-hidden="true" />
      <div>
        <p>{m.review_error()}</p>
        {#if onRetry}<button type="button" class="btn-primary" onclick={onRetry}
            >{m.progress_retry()}</button
          >{/if}
      </div>
    </div>
  {:else if !snapshot}
    <div class="recall-loading" role="status">
      <span class="sr-only">{m.review_loading()}</span>
      <div class="skeleton" aria-hidden="true"></div>
    </div>
  {:else if !hasRecall}
    <section class="recall-card recall-empty" aria-labelledby="recall-empty-title">
      <ShieldCheck size={28} aria-hidden="true" />
      <h2 id="recall-empty-title">{m.review_empty_title()}</h2>
      <p>{m.review_empty_description()}</p>
      <div class="recall-actions">
        <a class="btn-primary" href={localizedHref('/morse/learn')}>{m.review_empty_guided()}</a>
        <a class="btn-ghost" href={localizedHref('/morse')}>{m.review_empty_familiarize()}</a>
      </div>
    </section>
  {:else}
    {#if snapshot.coverage !== 'complete'}
      <p class="coverage-note" role="status">
        {snapshot.coverage === 'partial'
          ? m.learning_coverage_partial()
          : m.learning_coverage_local()}
      </p>
    {/if}

    {#if action}
      <section class="recall-card recall-primary" aria-labelledby="recall-primary-title">
        <p class="eyebrow">{m.review_recommended()}</p>
        <h2 id="recall-primary-title">{action.title}</h2>
        {#if action.hint}<p>{action.hint}</p>{/if}
        <a class="btn-primary" href={localizedHref(action.href)}>{action.title}</a>
      </section>
    {/if}

    <div class="recall-grid">
      <section class="recall-card" aria-labelledby="recall-due-title">
        <div class="section-heading">
          <RotateCcw size={20} aria-hidden="true" />
          <h2 id="recall-due-title">{m.review_due_title()}</h2>
        </div>
        {#if due.length}
          <p>{m.review_due_description()}</p>
          <ul class="recall-chips" role="list">
            {#each due as character (character.character)}
              <li>
                <a
                  href={localizedHref(
                    `/morse/learn/session?check=${encodeURIComponent(character.character)}`
                  )}
                  aria-label={m.review_due_check({ character: character.character })}
                  >{character.character}</a
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p>{m.review_due_empty()}</p>
        {/if}
      </section>

      <section class="recall-card" aria-labelledby="recall-attainment-title">
        <div class="section-heading">
          <CircleCheck size={20} aria-hidden="true" />
          <h2 id="recall-attainment-title">{m.review_attainment_title()}</h2>
        </div>
        <dl class="recall-counts">
          <div>
            <dt>{m.learning_proficiency()}</dt>
            <dd>{m.review_proficiency_count({ count: proficiency })}</dd>
          </div>
          <div>
            <dt>{m.learning_retention()}</dt>
            <dd>{m.review_retention_count({ count: retention })}</dd>
          </div>
        </dl>
        {#if provisional > 0}<p>{m.review_provisional_count({ count: provisional })}</p>{/if}
        <p>{m.review_attainment_hint()}</p>
        <a class="link" href={localizedHref('/morse/progress?view=characters')}
          >{m.review_progress_link()}</a
        >
      </section>
    </div>

    <section class="recall-card" aria-labelledby="recall-screening-title">
      <div class="section-heading">
        <ShieldCheck size={20} aria-hidden="true" />
        <h2 id="recall-screening-title">{m.review_screening_title()}</h2>
      </div>
      <p>{m.review_screening_description()}</p>
      {#if screeningHref}
        <a class="btn-ghost" href={screeningHref}>{m.review_screening_action()}</a>
      {:else}
        <p>{m.review_screening_empty()}</p>
        <div class="recall-actions">
          <a class="btn-ghost" href={localizedHref('/morse/learn')}>{m.review_guided_link()}</a>
          <a class="btn-ghost" href={localizedHref('/morse')}>{m.review_familiarize_link()}</a>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .recall-page {
    max-width: 60rem;
  }
  .recall-header {
    display: grid;
    gap: var(--space-2);
  }
  .recall-header .page-title {
    margin: 0;
  }
  .profile-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .recall-card {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
  }
  .recall-card h2,
  .recall-card p,
  .recall-card dl {
    margin: 0;
  }
  .recall-card h2 {
    font-size: var(--text-xl);
  }
  .recall-card p {
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  .recall-primary {
    border-inline-start: 3px solid var(--accent);
  }
  .eyebrow {
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--accent);
  }
  .recall-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-3);
  }
  .section-heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .section-heading :global(svg) {
    color: var(--accent);
    flex-shrink: 0;
  }
  .recall-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .recall-chips a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--answer-target-min);
    min-height: var(--answer-target-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-card);
    border-radius: var(--radius-sm);
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    text-decoration: none;
  }
  .recall-counts {
    display: grid;
    gap: var(--space-2);
  }
  .recall-counts div {
    display: grid;
    gap: var(--space-1);
  }
  .recall-counts dt {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .recall-counts dd {
    margin: 0;
    font-weight: 600;
  }
  .recall-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .coverage-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .recall-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    color: var(--status-bad);
  }
  .recall-alert :global(svg) {
    flex-shrink: 0;
  }
  .recall-alert p {
    margin: 0 0 var(--space-3);
  }
  .recall-loading {
    display: grid;
    min-height: 12rem;
  }
  .recall-loading .skeleton {
    width: 100%;
    height: 100%;
  }
  .recall-empty {
    justify-items: start;
  }
  .recall-empty :global(svg) {
    color: var(--accent);
  }
</style>

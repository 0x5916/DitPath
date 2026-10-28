<script lang="ts">
  import { armCheckStart } from '#lib/check-start-intent.ts';
  import { LEARNING_POLICY } from '#lib/training/learning-policy/policy.ts';
  import type { LearningSnapshot } from '../../data/learning-snapshot';
  import { learningRecommendationHref } from '../../data/learning-snapshot';
  import { recommendationTitle } from './recommendation-copy';
  import { localizedHref, lang } from '#lib/i18n.svelte.ts';
  import type { Attainment } from '../../training/learning-policy/types';
  import * as m from '#lib/paraglide/messages.js';
  let {
    snapshot,
    details = false,
    compact = false,
    progressView = null,
    onAction
  }: {
    snapshot: LearningSnapshot;
    details?: boolean;
    compact?: boolean;
    progressView?: string | null;
    onAction?: () => void;
  } = $props();
  import { browser } from '$app/env';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  let scrollRegion = $state<HTMLDivElement>();
  let filterControl = $state<HTMLSelectElement>();
  const filter = $derived(
    browser &&
      progressView &&
      ['met', 'not-met', 'stale'].includes(page.url.searchParams.get('status') ?? '')
      ? page.url.searchParams.get('status')!
      : 'all'
  );
  async function changeFilter(value: string) {
    const url = new URL(page.url.href);
    url.searchParams.set('view', 'characters');
    url.searchParams.set('status', value);
    await goto(url, { shallow: true, reset: false });
    await tick();
    scrollRegion?.scrollTo({ top: 0 });
    if (filterControl && filterControl.getBoundingClientRect().top < 0)
      filterControl.scrollIntoView({ block: 'start' });
  }
  const primary = $derived(snapshot.recommendation.primary);
  const nextHref = $derived(
    localizedHref(learningRecommendationHref(primary, snapshot.knownCharacters))
  );
  const checkTargets = $derived(
    new URL(nextHref, 'https://local.invalid').searchParams.get('check')
  );
  const promptCount = $derived(
    checkTargets
      ? checkTargets.length * LEARNING_POLICY.opportunitiesPerTarget +
          (snapshot.knownCharacters.some((c) => !checkTargets.includes(c))
            ? LEARNING_POLICY.anchorCount
            : 0)
      : 0
  );
  function prepareCheck(event: MouseEvent) {
    if (
      checkTargets &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    )
      armCheckStart(nextHref);
  }
  const known = $derived(
    snapshot.characters.filter((c) => snapshot.knownCharacters.includes(c.character))
  );
  const filtered = $derived(
    known.filter(
      (c) =>
        filter === 'all' ||
        (filter === 'stale'
          ? !['met', 'not-met'].includes(c.current.criterion)
          : c.current.criterion === filter)
    )
  );
  const dateFormat = $derived(
    new Intl.DateTimeFormat(lang.value, { dateStyle: 'medium', timeStyle: 'short' })
  );
  const award = (value: Attainment | null) =>
    !value
      ? m.learning_notyet()
      : value.status === 'verified'
        ? m.learning_awarded()
        : m.learning_provisional();
</script>

<section class="learning-overview" class:progress-evidence={details}>
  {#if progressView !== 'characters' && progressView !== 'history'}<div class="recommendation">
      {#if !compact}<header>
          <h2>
            {checkTargets
              ? m.mixed_targets({ characters: checkTargets.split('').join(', ') })
              : m.learning_overview_heading()}
          </h2>
          <p>
            {checkTargets
              ? m.check_entry_facts({ count: promptCount, speed: snapshot.profile.charWpm })
              : m.learning_overview_profile({ speed: snapshot.profile.charWpm })}
          </p>
        </header>{/if}
      {#if onAction}<button type="button" class="btn-primary" onclick={onAction}
          >{recommendationTitle(primary)}</button
        >
      {:else}
        <a class="btn-primary" href={nextHref} onclick={prepareCheck}
          >{checkTargets ? m.mixed_start() : recommendationTitle(primary)}</a
        >
      {/if}
    </div>{/if}
  {#if !compact && snapshot.coverage === 'partial'}<p role="status">
      {m.learning_coverage_partial()}
    </p>
  {:else if !compact && !progressView && snapshot.coverage === 'local-only'}<p class="supporting">
      {m.learning_coverage_local()}
    </p>{/if}
  {#if details}
    <div class="character-content" hidden={progressView !== null && progressView !== 'characters'}>
      <h2>{m.progress_character_records()}</h2>
      <p class="record-count" aria-live="polite">
        {m.progress_record_count({ count: filtered.length })}
      </p>
      {#if snapshot.confusions.length}
        <section>
          <h3>{m.progress_confusions()}</h3>
          {#each snapshot.confusions as finding (`${finding.expected}-${finding.actual}`)}
            <p>
              {m.learning_confusion({
                expected: finding.expected,
                actual: finding.actual,
                count: finding.confusionCount,
                total: finding.opportunityCount
              })}
            </p>
            {#if [finding.expected, finding.actual].every( (ch) => snapshot.knownCharacters.includes(ch) )}<a
                class="link"
                href={localizedHref(
                  `/morse/learn/session?review=${finding.expected}${finding.actual}`
                )}>{m.review_title({ characters: `${finding.expected}, ${finding.actual}` })}</a
              >{/if}
          {/each}
        </section>
      {/if}
      <label class="character-filter">
        <span class="sr-only">{m.progress_character_filter()}</span>
        <select
          class="select"
          bind:this={filterControl}
          bind:value={() => filter, (value) => void changeFilter(value)}
        >
          <option value="all">{m.history_all()}</option>
          <option value="not-met">{m.learning_current_notmet()}</option>
          <option value="met">{m.learning_current_met()}</option>
          <option value="stale">{m.learning_current_stale()}</option>
        </select>
      </label>
      <!-- Keyboard users must be able to scroll this named region. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        bind:this={scrollRegion}
        class="character-scroll"
        role="region"
        tabindex="0"
        aria-label={m.progress_tab_characters()}
      >
        <ul>
          {#if !filtered.length}<li class="empty-records">
              <p>{m.progress_no_characters()}</p>
              {#if filter !== 'all'}<button
                  class="btn-ghost"
                  onclick={() => void changeFilter('all')}>{m.history_all()}</button
                >{/if}
            </li>{/if}
          {#each filtered as character (character.character)}
            <li>
              <details class="character-evidence">
                <summary>
                  <strong>{character.character}</strong>
                  <span
                    >{character.current.criterion === 'met'
                      ? m.learning_current_met()
                      : character.current.criterion === 'not-met'
                        ? m.learning_current_notmet()
                        : m.learning_current_stale()}</span
                  >
                  <ChevronDown size={20} aria-hidden="true" />
                </summary>
                <div class="evidence-details">
                  {#if character.current.counts && character.current.counts.eligible > 0}<p>
                      {m.mixed_count({
                        character: character.character,
                        correct: character.current.counts.unassistedCorrect,
                        total: character.current.counts.eligible
                      })}
                    </p>{/if}
                  <h3>{m.progress_past_milestones()}</h3>
                  <dl>
                    <div>
                      <dt>{m.learning_proficiency()}</dt>
                      <dd>{award(character.proficiency)}</dd>
                    </div>
                    <div>
                      <dt>{m.learning_retention()}</dt>
                      <dd>{award(character.retention)}</dd>
                    </div>
                  </dl>
                  {#if character.evidence.revalidation.length || character.evidence.historical.some((a) => a.status === 'unverified')}<p
                    >
                      {m.learning_claim_uncertain()}
                    </p>{/if}
                  {#if character.review}<p>
                      {character.review.ready
                        ? m.learning_review_due()
                        : character.review.reason === 'upcoming'
                          ? m.learning_review_on({
                              date: dateFormat.format(new Date(character.review.dueAt))
                            })
                          : m.learning_review_wait()}
                    </p>{/if}
                  <a
                    class="link"
                    href={localizedHref(
                      `/morse/learn/session?check=${encodeURIComponent(character.character)}`
                    )}>{m.learning_check({ character: character.character })}</a
                  >
                </div>
              </details>
            </li>
          {/each}
        </ul>
      </div>
      <p class="record-note">{m.learning_history_hint()}</p>
    </div>
  {/if}
</section>

<style>
  .record-count {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
  }
  .record-note {
    margin-top: var(--space-6);
    font-size: var(--text-sm);
  }
  .empty-records {
    padding: var(--space-4);
    align-items: flex-start;
  }
  .evidence-details h3 {
    margin: 0;
    font-size: var(--text-base);
  }
  .character-evidence summary,
  .evidence-details a {
    scroll-margin-block: 6rem;
  }
  .character-scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
  .character-content {
    width: 100%;
  }
  .character-scroll ul {
    grid-template-columns: 1fr;
  }
  .character-filter {
    display: grid;
    gap: var(--space-3);
    width: 100%;
    position: sticky;
    top: 0;
    z-index: 2;
    padding-block: var(--space-3);
    background: var(--bg-base);
  }
  .character-filter select {
    min-height: 48px;
  }
  .character-scroll {
    width: 100%;
  }
  @media (min-width: 960px) and (min-height: 700px) {
    .character-scroll {
      max-height: min(55dvh, calc(100dvh - 24rem));
      overflow-y: auto;
      scrollbar-gutter: stable;
      padding-right: var(--space-2);
    }
    .character-filter select {
      max-width: 24rem;
    }
  }

  .recommendation {
    display: contents;
  }
  .progress-evidence {
    gap: var(--space-6);
  }
  .progress-evidence .recommendation {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-6);
    width: 100%;
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
  }
  .progress-evidence header p {
    font-size: var(--text-sm);
  }
  .progress-evidence .recommendation .btn-primary {
    flex-shrink: 0;
    min-height: 3.25rem;
  }
  .progress-evidence > p {
    font-size: var(--text-sm);
  }
  .character-evidence {
    width: 100%;
  }
  .character-evidence summary {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: 4.5rem;
    padding: var(--space-4);
    cursor: pointer;
    list-style: none;
  }
  .character-evidence summary::-webkit-details-marker {
    display: none;
  }
  .character-evidence summary :global(svg) {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .character-evidence[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .character-evidence summary strong {
    width: 2rem;
    flex-shrink: 0;
    font-size: var(--text-2xl);
  }
  .character-evidence summary span {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .evidence-details {
    display: grid;
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-4);
  }
  @media (max-width: 639px) {
    .progress-evidence .recommendation {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  .learning-overview {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    width: 100%;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h2,
  p,
  dl {
    margin: 0;
  }
  h2 {
    font-size: var(--text-xl);
  }
  p {
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  .supporting {
    font-size: var(--text-sm);
  }
  section a.link {
    min-height: 3rem;
    display: inline-flex;
    align-items: center;
  }
  a.btn-primary,
  button.btn-primary {
    min-height: 3rem;
    white-space: normal;
    text-align: center;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: var(--space-2);
    width: 100%;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
  }
  dl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
  }
  dd {
    margin: 0;
  }
  dt {
    color: var(--text-secondary);
  }
</style>

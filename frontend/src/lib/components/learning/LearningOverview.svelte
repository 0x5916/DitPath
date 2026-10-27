<script lang="ts">
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
    onAction
  }: {
    snapshot: LearningSnapshot;
    details?: boolean;
    compact?: boolean;
    onAction?: () => void;
  } = $props();
  const primary = $derived(snapshot.recommendation.primary);
  const known = $derived(
    snapshot.characters.filter((c) => snapshot.knownCharacters.includes(c.character))
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

<section class="learning-overview">
  {#if !compact}<header>
      <h2>{m.learning_overview_heading()}</h2>
      <p>{m.learning_overview_profile({ speed: snapshot.profile.charWpm })}</p>
    </header>{/if}
  {#if onAction}<button type="button" class="btn-primary" onclick={onAction}
      >{recommendationTitle(primary)}</button
    >
  {:else}
    <a
      class="btn-primary"
      href={localizedHref(learningRecommendationHref(primary, snapshot.knownCharacters))}
      >{recommendationTitle(primary)}</a
    >
  {/if}
  {#if !compact && snapshot.coverage === 'partial'}<p role="status">
      {m.learning_coverage_partial()}
    </p>
  {:else if !compact && snapshot.coverage === 'local-only'}<p class="supporting">
      {m.learning_coverage_local()}
    </p>{/if}
  {#if details}
    <p>{m.learning_history_hint()}</p>
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
    <ul>
      {#each known as character (character.character)}
        <li>
          <div class="character-heading">
            <strong>{character.character}</strong><a
              class="link"
              href={localizedHref(
                `/morse/learn/session?check=${encodeURIComponent(character.character)}`
              )}>{m.learning_check({ character: character.character })}</a
            >
          </div>
          <p>
            {character.current.criterion === 'met'
              ? m.learning_current_met()
              : character.current.criterion === 'not-met'
                ? m.learning_current_notmet()
                : m.learning_current_stale()}
          </p>
          {#if character.current.counts && character.current.counts.eligible > 0}<p>
              {m.mixed_count({
                character: character.character,
                correct: character.current.counts.unassistedCorrect,
                total: character.current.counts.eligible
              })}
            </p>{/if}
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
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
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
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-6);
    width: 100%;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
  }
  .character-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .character-heading strong {
    font-size: var(--text-2xl);
  }
  .character-heading a {
    min-height: 3rem;
    display: flex;
    align-items: center;
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

<script lang="ts">
  import type { LearningHistoryEntry } from '../../data/learning-history';
  import { formatDateTime } from '#lib/format.ts';
  import * as m from '#lib/paraglide/messages.js';
  let { entries }: { entries: LearningHistoryEntry[] } = $props();
  let purpose = $state('all'),
    outcome = $state('all'),
    limit = $state(20);
  const filtered = $derived(
    entries.filter(
      (r) =>
        (purpose === 'all' || r.purpose === purpose) && (outcome === 'all' || r.status === outcome)
    )
  );
  const purposeLabel = (purpose: string) => {
    switch (purpose) {
      case 'coaching':
        return m.history_coaching();
      case 'screening':
        return m.review_return_title();
      default:
        return m.mixed_title();
    }
  };
  const statusLabel = (status: string, recordedStatus?: string, evidenceStatus?: string) => {
    if (status === 'completed') return m.history_completed();
    if (status === 'incomplete') {
      if (evidenceStatus === 'rejected') return m.history_evidence_rejected();
      return recordedStatus === 'completed'
        ? m.history_incomplete_evidence()
        : m.history_incomplete();
    }
    if (status === 'abandoned') return m.history_abandoned();
    return m.history_inprogress();
  };
</script>

<section class="learning-history">
  <h2>{m.history_learning()}</h2>
  <div class="filters">
    <label
      >{m.history_purpose()}<select
        class="select"
        bind:value={purpose}
        onchange={() => (limit = 20)}
      >
        <option value="all">{m.history_all()}</option><option value="coaching"
          >{m.history_coaching()}</option
        ><option value="screening">{m.review_return_title()}</option><option value="mixed-check"
          >{m.mixed_title()}</option
        >
      </select></label
    >
    <label
      >{m.history_outcome()}<select
        class="select"
        bind:value={outcome}
        onchange={() => (limit = 20)}
      >
        <option value="all">{m.history_all()}</option
        >{#each ['completed', 'incomplete', 'abandoned', 'in-progress'] as state (state)}<option
            value={state}>{statusLabel(state)}</option
          >{/each}
      </select></label
    >
  </div>
  {#if !filtered.length}<p>{m.history_empty()}</p>{/if}
  <ol>
    {#each filtered.slice(0, limit) as entry (entry.id)}
      <li>
        <details>
          <summary
            ><strong
              >{purposeLabel(entry.purpose)}{entry.targets.length
                ? ` · ${entry.targets.join(', ')}`
                : ''}</strong
            >
            · {statusLabel(
              entry.status,
              entry.recordedStatus,
              entry.evidenceStatus ?? undefined
            )}{#if entry.status === 'incomplete' && entry.recordedStatus === 'completed'}<span
                class="recorded-status">· {m.history_recorded_completed()}</span
              >{/if}<time datetime={entry.at}>{formatDateTime(entry.at)}</time></summary
          >
          <p>{m.practice_speed_summary({ character: entry.charWpm, effective: entry.effWpm })}</p>
          <p>{m.history_answers({ answered: entry.answered, planned: entry.planned })}</p>
          {#if entry.correct !== null}
            <p>
              {m.history_counts({
                correct: entry.correct,
                replayed: entry.replayed,
                skipped: entry.skipped,
                invalid: entry.invalid
              })}
            </p>
            <ul>
              {#each entry.responses as response (response.id)}<li>
                  {response.expected} → {response.answer || '—'}
                </li>{/each}
            </ul>
          {:else}<p>{m.history_feedback_hidden()}</p>{/if}
          {#each entry.milestones as claim (claim.id)}<p>
              {claim.character} · {claim.kind === 'proficiency'
                ? m.learning_proficiency()
                : m.learning_retention()} · {claim.corrected
                ? m.history_claim_changed()
                : m.learning_awarded()}
            </p>{/each}
        </details>
      </li>
    {/each}
  </ol>
  {#if filtered.length > limit}<button class="btn-ghost" onclick={() => (limit += 20)}
      >{m.history_more()}</button
    >{/if}
</section>

<style>
  .learning-history {
    margin-block: var(--space-6);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  label {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    flex: 1;
  }
  ol {
    list-style: none;
    padding: 0;
  }
  ol > li {
    margin-block: var(--space-4);
  }
  summary {
    cursor: pointer;
    min-height: var(--answer-target-min);
    padding-block: var(--space-2);
  }
  .recorded-status {
    margin-inline-start: var(--space-1);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  time {
    display: block;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    list-style: none;
    padding: 0;
  }
</style>

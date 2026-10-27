<script lang="ts">
  import type { SessionCheckpoint } from '../../data/session-checkpoints';
  import { localizedHref, lang } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  let {
    entries,
    onDiscard,
    onContinue,
    busy = false
  }: {
    entries: SessionCheckpoint[];
    onDiscard: (entry: SessionCheckpoint) => void;
    onContinue?: (entry: SessionCheckpoint) => void;
    busy?: boolean;
  } = $props();
  const dates = $derived(
    new Intl.DateTimeFormat(lang.value, { dateStyle: 'medium', timeStyle: 'short' })
  );
</script>

{#if entries.length}<section class="saved-sessions">
    <h2>{m.session_saved_heading()}</h2>
    <p>{m.session_saved_hint()}</p>
    {#each entries as entry (entry.id)}<article>
        <strong
          >{entry.kind === 'copy'
            ? m.nav_practice()
            : entry.mixed
              ? m.mixed_title()
              : entry.review
                ? m.review_history_heading()
                : m.home_lesson_title({
                    step: entry.record.step,
                    characters: entry.state.currentPrompt?.spec.characters.join(', ') ?? ''
                  })}</strong
        >
        <time datetime={entry.savedAt}>{dates.format(new Date(entry.savedAt))}</time>
        {#if entry.kind === 'guided'}<p>
            {m.session_position({
              current: entry.state.currentPromptIndex + 1,
              total: entry.state.prompts.length
            })}
          </p>{/if}
        <div>
          {#if onContinue}<button
              class="btn-primary"
              disabled={busy}
              onclick={() => onContinue?.(entry)}>{m.session_continue()}</button
            >{:else}<a
              class="btn-primary"
              href={localizedHref(
                `${entry.href}${entry.href.includes('?') ? '&' : '?'}resume=${encodeURIComponent(entry.id)}`
              )}>{m.session_continue()}</a
            >{/if}<button class="btn-ghost" disabled={busy} onclick={() => onDiscard(entry)}
            >{m.session_discard()}</button
          >
        </div>
      </article>{/each}
  </section>{/if}

<style>
  .saved-sessions {
    margin-block: var(--space-6);
  }
  article {
    margin-block: var(--space-4);
  }
  time {
    display: block;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  article > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  a,
  button {
    min-height: var(--answer-target-min);
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import { getAdminMailSession, recipientLimit } from '#lib/admin-mail.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  let { children }: { children?: Snippet } = $props();
  const mail = getAdminMailSession();
</script>

<div class="selection">
  <div class="selection-head">
    <p class="body-text" role="status">
      {m.mail_selected({ count: mail.draft.recipients.length, limit: recipientLimit })}
    </p>
    {@render children?.()}
  </div>
  {#if mail.draft.recipients.length}
    <ul role="list">
      {#each mail.draft.recipients as person (person.id)}
        <li>
          <button
            type="button"
            class="btn-ghost"
            aria-label={m.mail_remove({ name: person.username })}
            disabled={!!mail.draft.pending}
            onclick={() => mail.draft.toggle(person)}
            >{person.username}<X size={14} aria-hidden="true" /></button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .selection-head,
  ul {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .selection-head {
    justify-content: space-between;
  }
  .selection-head p {
    margin: 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: var(--space-2) 0 0;
  }
  li,
  button {
    max-width: 100%;
  }
  button {
    min-height: var(--answer-target-min);
    gap: var(--space-2);
    overflow-wrap: anywhere;
    font-size: var(--text-sm);
  }
  button :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
</style>

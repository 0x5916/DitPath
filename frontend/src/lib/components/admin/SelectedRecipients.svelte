<script lang="ts">
  import { X } from '@lucide/svelte';
  import { getAdminMailSession, recipientLimit } from '#lib/admin-mail.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';
  const mail = getAdminMailSession();
</script>

<div class="selection">
  <p role="status">
    {m.mail_selected({ count: mail.draft.recipients.length, limit: recipientLimit })}
  </p>
  {#if mail.draft.recipients.length}
    <ul>
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
  .selection p {
    margin: 0;
    color: var(--text-muted);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: var(--space-2) 0 0;
  }
  button {
    gap: var(--space-1);
    min-height: 40px;
  }
</style>

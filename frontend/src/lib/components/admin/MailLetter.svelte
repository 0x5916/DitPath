<script lang="ts">
  import type { EmailTopic } from '#lib/api.ts';
  import { topicLabels } from '#lib/admin-mail.svelte.ts';
  import { formatDateTime } from '#lib/format.ts';
  import * as m from '#lib/paraglide/messages.js';

  let {
    topic,
    from,
    replyTo,
    subject,
    body,
    footer,
    createdAt
  }: {
    topic: EmailTopic;
    from: string;
    replyTo: string;
    subject?: string;
    body: string;
    footer: string;
    createdAt?: string;
  } = $props();
</script>

<article class="panel letter">
  <dl>
    <dt>{m.mail_topic()}</dt>
    <dd>{topicLabels[topic]()}</dd>
    {#if createdAt}<dt>{m.admin_date()}</dt>
      <dd><time datetime={createdAt}>{formatDateTime(createdAt)}</time></dd>{/if}
    <dt>{m.mail_from()}</dt>
    <dd>{from}</dd>
    <dt>{m.mail_reply()}</dt>
    <dd>{replyTo}</dd>
  </dl>
  <div class="content">
    {#if subject}<h3 class="card-title">{subject}</h3>{/if}
    <p class="body-text body-text--prose copy">{body}</p>
  </div>
  <footer class="body-text">
    <p class="copy">{footer}</p>
    <p>{m.mail_unsubscribe()}</p>
  </footer>
</article>

<style>
  .letter {
    display: grid;
    gap: var(--space-4);
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: fit-content(40%) minmax(0, 1fr);
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
  }
  dt,
  footer {
    color: var(--text-muted);
  }
  .content {
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
  }
  .copy {
    white-space: pre-wrap;
  }
</style>

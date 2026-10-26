<script lang="ts">
  import { CircleAlert } from '@lucide/svelte';
  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<div class="error-alert" role="alert">
  <CircleAlert size={18} class="alert-mark" aria-hidden="true" />
  <p class="error-message">{message}</p>
</div>

<style>
  /* Error notice: hairline box with a status-coloured left rule. The severity
     is carried by the rule and the dot, the text stays readable ink. */
  .error-alert {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid;
    border-left-width: 3px;
    border-radius: var(--radius-sm);
    --alert-color: var(--status-bad);
    background: var(--status-bad-tint);
    border-color: color-mix(in srgb, var(--status-bad) 30%, transparent);
  }

  .error-alert :global(.alert-mark) {
    flex-shrink: 0;
    margin-top: 0.1rem;
    color: var(--status-bad);
  }

  .error-message {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--text-primary);
  }
</style>

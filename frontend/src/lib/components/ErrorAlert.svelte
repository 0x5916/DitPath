<script lang="ts">
  interface Props {
    message: string;
  }

  let { message }: Props = $props();
</script>

<div class="error-alert" role="alert">
  <span class="alert-mark" aria-hidden="true"></span>
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

  .alert-mark {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    margin-top: 0.42rem;
    border-radius: 50%;
    background: var(--alert-color);
  }

  .error-message {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--text-primary);
  }
</style>

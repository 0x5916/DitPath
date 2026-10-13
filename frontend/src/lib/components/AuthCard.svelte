<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    subtitle: string;
    footer: Snippet;
    children: Snippet;
  }

  let { title, subtitle, footer, children }: Props = $props();
</script>

<div class="page-narrow">
  <div class="card auth-card">
    <h1 class="page-title auth-title">{title}</h1>
    <p class="body-text auth-subtitle">{subtitle}</p>

    {@render children()}

    <p class="body-text auth-footer-text">{@render footer()}</p>
  </div>
</div>

<style>
  .auth-card {
    max-width: 26rem;
    margin-left: auto;
    margin-right: auto;
    padding: var(--space-6);
  }

  /* `.page-title` already carries the h1 scale; the card only owns the gap.
     No rule here: the title and its subtitle are one unit, and the card's own
     border already bounds the pair. */
  .auth-title {
    margin-bottom: var(--space-2);
  }

  .auth-subtitle {
    margin-bottom: 1.25rem;
  }

  .auth-footer-text {
    margin: var(--block-gap) 0 0;
    text-align: center;
  }

  @media (max-width: 639px) {
    .auth-card {
      padding: var(--space-4);
    }
  }
</style>

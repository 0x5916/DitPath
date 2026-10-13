<script lang="ts">
  import { ArrowRight } from '@lucide/svelte';

  interface Props {
    title: string;
    description: string;
    actionLabel?: string;
    href?: string;
    onclick?: () => void;
  }

  let { title, description, actionLabel = 'Start', href, onclick = () => {} }: Props = $props();
</script>

<div class="practice-card">
  <div class="card-content">
    <h3 class="card-title">{title}</h3>
    <p class="card-desc">{description}</p>
  </div>
  <div class="card-action">
    {#if href}
      <a {href} class="btn-primary action-btn">
        <span>{actionLabel}</span>
        <ArrowRight size={16} />
      </a>
    {:else}
      <button type="button" class="btn-primary action-btn" {onclick}>
        <span>{actionLabel}</span>
        <ArrowRight size={16} />
      </button>
    {/if}
  </div>
</div>

<style>
  .practice-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5);
    background-color: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: border-color var(--transition-fast);
  }

  .practice-card:hover {
    border-color: var(--border-subtle);
  }

  .card-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .card-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
  }

  .card-desc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .card-action {
    display: flex;
    justify-content: flex-start;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
</style>

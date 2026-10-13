<script lang="ts">
  import { acceptsSessionShortcut } from './keyboard';
  interface Props {
    options: string[];
    disabled?: boolean;
    onSelect: (option: string) => void;
  }

  let { options = [], disabled = false, onSelect = () => {} }: Props = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (disabled || !acceptsSessionShortcut(event, true)) return;
    const key = event.key.toUpperCase();
    if (options.includes(key)) {
      event.preventDefault();
      onSelect(key);
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="character-grid" role="group" aria-label="Character options">
  {#each options as option (option)}
    <button
      type="button"
      class="grid-cell"
      {disabled}
      onclick={() => onSelect(option)}
      aria-label={`Select ${option}`}
    >
      <span class="grid-char">{option}</span>
    </button>
  {/each}
</div>

<style>
  .character-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    max-width: 28rem;
    margin: var(--space-4) 0;
  }

  .grid-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: var(--answer-target-min, 3rem);
    min-height: var(--answer-target-min, 3rem);
    width: 4rem;
    height: 4rem;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    cursor: pointer;
    position: relative;
    transition:
      background-color var(--transition-fast),
      border-color var(--transition-fast),
      transform var(--transition-fast);
  }

  .grid-cell:hover:not(:disabled) {
    background-color: var(--bg-inset);
    border-color: var(--accent);
  }

  .grid-cell:active:not(:disabled) {
    transform: scale(0.96);
  }

  .grid-cell:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .grid-char {
    font-family: var(--font-mono);
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1;
  }
</style>

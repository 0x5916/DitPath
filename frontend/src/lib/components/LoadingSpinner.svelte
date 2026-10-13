<script lang="ts">
  import * as m from '$lib/paraglide/messages';
</script>

<div class="loading-container" role="status" aria-live="polite">
  <span class="loading-spinner" aria-hidden="true"></span>
  <span class="sr-only">{m.common_loading()}</span>
</div>

<style>
  .loading-container {
    display: flex;
    justify-content: center;
    padding: 2rem;
  }

  .loading-spinner {
    width: 1.5rem;
    height: 1.5rem;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

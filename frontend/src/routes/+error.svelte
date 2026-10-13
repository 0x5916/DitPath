<script lang="ts">
  import { page } from '$app/state';
  import { House, Radio } from '@lucide/svelte';
  import { localizedHref as href } from '$lib/i18n.svelte';
  import * as m from '$lib/paraglide/messages';

  // Unknown URLs land here with a 404 from SvelteKit; anything else is a real
  // failure (a load that threw, a 500 from the API) and gets generic wording.
  const isNotFound = $derived(page.status === 404);
</script>

<div class="page-narrow">
  <div class="error-head">
    <p class="eyebrow">{page.status}</p>
    <h1 class="page-title">
      {isNotFound ? m.error_title() : m.error_generic_title()}
    </h1>
    <p class="body-text error-body">
      {isNotFound ? m.error_body() : m.error_generic_body()}
    </p>
  </div>
  <div class="error-actions">
    <a href={href('/')} class="btn-primary">
      <House size={16} aria-hidden="true" />
      {m.error_cta_home()}
    </a>
    <a href={href('/morse/learn')} class="btn-ghost">
      <Radio size={16} aria-hidden="true" />
      {m.home_cta()}
    </a>
  </div>
</div>

<style>
  /* A state page keeps the masthead shape: status eyebrow, neutral page title,
     then one filled primary action beside a quiet secondary. */
  .error-body {
    margin: var(--space-3) 0 0;
    max-width: 30rem;
  }

  .error-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
</style>

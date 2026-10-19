<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import MorseSectionNav from '#lib/components/MorseSectionNav.svelte';
  import ContinuousCopyPractice from '#lib/components/practice/ContinuousCopyPractice.svelte';
  import * as m from '#lib/paraglide/messages.js';

  // Keep existing character-explorer bookmarks useful after giving the tool its own page.
  onMount(() => {
    if (page.url.searchParams.get('mode') === 'familiarize') {
      void goto(localizedHref('/morse'), { replace: true });
    }
  });
</script>

<svelte:head>
  <title>{m.nav_practice()} · DitPath</title>
</svelte:head>

<div class="page-narrow">
  <MorseSectionNav current="practice" />
  <header class="practice-header">
    <h1 class="page-title">{m.nav_practice()}</h1>
    <p class="body-text">{m.practice_hub_subtitle()}</p>
    <p class="practice-notice">{m.practice_mastery_notice()}</p>
  </header>

  <ContinuousCopyPractice />
</div>

<style>
  .practice-header .body-text {
    margin: var(--space-2) 0 0;
  }

  .practice-notice {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
</style>

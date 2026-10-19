<script lang="ts">
  import { goto } from '$app/navigation';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import { SITE_NAME } from '#lib/seo.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import MorseSectionNav from '#lib/components/MorseSectionNav.svelte';
  import FamiliarizationPractice from '#lib/components/practice/FamiliarizationPractice.svelte';
  import * as m from '#lib/paraglide/messages.js';
</script>

<svelte:head>
  <title>{m.morse_title()} · {SITE_NAME}</title>
</svelte:head>

<div class="page-narrow">
  <MorseSectionNav current="tools" />
  <header class="morse-header">
    <h1 class="page-title">{m.morse_title()}</h1>
    <p class="body-text">{m.morse_intro()}</p>
  </header>

  <FamiliarizationPractice
    lesson={LESSONS.length}
    onStartPassage={() => void goto(href('/morse/practice'))}
  />
</div>

<style>
  .morse-header .body-text {
    margin: var(--space-2) 0 0;
  }
</style>

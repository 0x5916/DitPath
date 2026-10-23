<script lang="ts">
  import { goto } from '$app/navigation';
  import { localizedHref as href } from '#lib/i18n.svelte.ts';
  import { SITE_NAME } from '#lib/seo.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
  import InfoTip from '#lib/components/InfoTip.svelte';
  import FamiliarizationPractice from '#lib/components/practice/FamiliarizationPractice.svelte';
  import * as m from '#lib/paraglide/messages.js';
</script>

<svelte:head>
  <title>{m.morse_title()} · {SITE_NAME}</title>
</svelte:head>

<div class="page-narrow">
  <header class="morse-header">
    <div class="morse-heading">
      <h1 class="page-title">{m.morse_title()}</h1>
      <InfoTip label={m.common_tip_label({ topic: m.morse_title() })} text={m.morse_intro()} />
    </div>
    <p class="morse-note">{m.morse_unscored_notice()}</p>
  </header>

  <FamiliarizationPractice
    lesson={LESSONS.length}
    onStartPassage={() => void goto(href('/morse/practice'))}
  />
</div>

<style>
  .morse-heading {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .morse-note {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>

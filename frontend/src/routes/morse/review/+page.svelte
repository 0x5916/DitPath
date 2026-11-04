<script lang="ts">
  import { onMount } from 'svelte';
  import RecallHome from '#lib/components/learning/RecallHome.svelte';
  import { createLearningView } from '#lib/learning-view.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  const learning = createLearningView();

  onMount(() => {
    const stop = learning.start();
    return stop;
  });
</script>

<svelte:head>
  <title>{m.review_page_title()} · OpenCW</title>
</svelte:head>

<RecallHome
  snapshot={learning.snapshot}
  failed={learning.failed}
  onRetry={() => void learning.refresh()}
/>

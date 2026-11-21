<script lang="ts">
  import { onMount } from 'svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import { RECOVERY_ORIGIN, recoverDeviceHistory } from '#lib/data/domain-recovery.ts';
  import * as m from '#lib/paraglide/messages.js';

  let canonical = $state(false);
  let busy = $state(false);
  let result = $state('');
  onMount(() => {
    canonical = location.origin === RECOVERY_ORIGIN;
  });

  async function recover() {
    if (busy) return;
    busy = true;
    result = '';
    try {
      const count = await recoverDeviceHistory();
      result = count > 0 ? m.domain_recovery_done() : m.domain_recovery_empty();
    } catch (error) {
      result =
        error instanceof Error && error.message === 'conflict'
          ? m.domain_recovery_conflict()
          : m.domain_recovery_error();
    } finally {
      busy = false;
    }
  }
</script>

<section id="device-recovery" aria-labelledby="device-recovery-title">
  <h3 id="device-recovery-title">{m.domain_recovery_title()}</h3>
  <p class="field-hint">{m.domain_recovery_hint()}</p>
  {#if canonical}
    <button type="button" class="btn-ghost" disabled={busy} onclick={recover}>
      {busy ? m.history_importing() : m.domain_recovery_action()}
    </button>
  {:else}
    <a
      class="link standalone-target"
      href={RECOVERY_ORIGIN + localizedHref('/settings') + '#device-recovery'}
      >{m.domain_recovery_action()}</a
    >
  {/if}
  {#if result}<p role="status">{result}</p>{/if}
</section>

<style>
  #device-recovery {
    margin-block-start: var(--block-gap);
    display: grid;
    justify-items: start;
    gap: var(--space-2);
  }
</style>

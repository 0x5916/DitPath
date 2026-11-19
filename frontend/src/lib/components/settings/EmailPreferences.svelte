<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { Check } from '@lucide/svelte';
  import {
    getEmailPreferences,
    setEmailPreference,
    type EmailPreferences,
    type EmailTopic
  } from '#lib/api.ts';
  import { topicLabels, mailError } from '#lib/admin-mail.svelte.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import * as m from '#lib/paraglide/messages.js';

  const scope = createSessionScope();
  const topics: EmailTopic[] = ['support', 'product'];
  let prefs = $state.raw<EmailPreferences | null>(null);
  let busy = $state(false);
  let error = $state('');
  let saved = $state(false);
  let errorBox = $state<HTMLDivElement>();
  async function load() {
    const current = scope.begin();
    busy = true;
    error = '';
    saved = false;
    try {
      const result = await getEmailPreferences();
      if (current()) prefs = result;
    } catch (e) {
      if (current()) error = mailError(e);
    } finally {
      if (current()) busy = false;
    }
  }
  async function change(topic: EmailTopic, event: Event) {
    if (!prefs || busy) return;
    const input = event.currentTarget as HTMLInputElement;
    const enabled = input.checked;
    input.checked = prefs[topic];
    const current = scope.begin();
    busy = true;
    error = '';
    saved = false;
    try {
      const result = await setEmailPreference(prefs.email, topic, enabled);
      if (current()) {
        prefs = result;
        saved = true;
      }
    } catch (e) {
      if (current()) {
        error = mailError(e);
        await tick();
        if (current()) errorBox?.focus();
      }
    } finally {
      if (current()) busy = false;
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(scope.dispose);
</script>

<section class="panel panel--ledger" aria-labelledby="mail-pref-title">
  <h2 class="card-title" id="mail-pref-title">{m.mail_prefs()}</h2>
  {#if prefs}
    <p class="body-text">
      {prefs.verified ? m.mail_pref_address({ email: prefs.email }) : m.mail_verify_first()}
    </p>
    {#each topics as topic (topic)}
      <label class="choice"
        ><input
          type="checkbox"
          checked={prefs[topic]}
          disabled={!prefs.verified}
          aria-disabled={busy || !prefs.verified}
          onclick={(e) => {
            if (busy) e.preventDefault();
          }}
          onchange={(e) => void change(topic, e)}
        />{topicLabels[topic]()}</label
      >
    {/each}
  {/if}
  {#if error}<div tabindex="-1" bind:this={errorBox}><ErrorAlert message={error} /></div>
    <button type="button" class="btn-ghost" onclick={load}>{m.common_retry()}</button>
  {/if}
  <p role="status">
    {#if busy}{prefs ? m.common_saving() : m.common_loading()}{:else if saved}<Check
        size={16}
        aria-hidden="true"
      />{m.settings_saved()}{/if}
  </p>
</section>

<style>
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    cursor: pointer;
  }
  [role='status'] {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  [role='status']:empty {
    margin: 0;
  }
</style>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { updatePassword } from '#lib/api.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import SaveButton from '#lib/components/SaveButton.svelte';
  import * as m from '#lib/paraglide/messages.js';

  const sessionScope = createSessionScope();
  const timers = new SvelteSet<ReturnType<typeof setTimeout>>();
  onDestroy(() => {
    sessionScope.dispose();
    for (const timer of timers) clearTimeout(timer);
  });

  function later(callback: () => void, delay: number): void {
    const current = sessionScope.capture();
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (current()) callback();
    }, delay);
    timers.add(timer);
  }

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let passwordSaving = $state(false);
  let passwordError = $state('');
  let passwordSaved = $state(false);

  const passwordDirty = $derived(
    currentPassword.trim() !== '' || newPassword.trim() !== '' || confirmPassword.trim() !== ''
  );

  async function savePassword(e: SubmitEvent) {
    const current = sessionScope.capture();
    e.preventDefault();
    if (!passwordDirty || passwordSaving) return;
    passwordSaving = true;
    passwordError = '';
    passwordSaved = false;

    if (newPassword.length < 8) {
      passwordError = m.settings_password_min_length();
      passwordSaving = false;
      return;
    }

    if (newPassword !== confirmPassword) {
      passwordError = m.register_error_mismatch();
      passwordSaving = false;
      return;
    }

    try {
      await updatePassword(currentPassword, newPassword);
      if (!current()) return;
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      passwordSaved = true;
      later(() => (passwordSaved = false), 3000);
    } catch (err) {
      if (!current()) return;
      passwordError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) passwordSaving = false;
    }
  }
</script>

<details class="panel panel--ledger ui-disclosure">
  <summary>{m.settings_password_section()}</summary>
  <form onsubmit={savePassword} class="settings-form">
    <label class="field">
      <span class="label-text">{m.settings_current_password_label()}</span>
      <input
        type="password"
        bind:value={currentPassword}
        disabled={passwordSaving}
        class="input"
        minlength="8"
        autocomplete="current-password"
        required
      />
    </label>
    <label class="field">
      <span class="label-text">{m.settings_new_password_label()}</span>
      <input
        type="password"
        bind:value={newPassword}
        disabled={passwordSaving}
        class="input"
        minlength="8"
        autocomplete="new-password"
        required
      />
    </label>
    <label class="field">
      <span class="label-text">{m.settings_confirm_new_password_label()}</span>
      <input
        type="password"
        bind:value={confirmPassword}
        disabled={passwordSaving}
        class="input"
        minlength="8"
        autocomplete="new-password"
        required
      />
    </label>
    {#if passwordError}
      <ErrorAlert message={passwordError} />
    {/if}
    {#if passwordDirty || passwordSaving || passwordSaved}
      <div class="settings-action-row">
        <SaveButton saving={passwordSaving} saved={passwordSaved} />
      </div>
    {/if}
  </form>
</details>

<style>
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .settings-action-row {
    display: flex;
    justify-content: flex-end;
  }
</style>

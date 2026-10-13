<script lang="ts">
  import { register, user } from '$lib/auth';
  import { localizeApiError } from '$lib/errorLocalization';
  import { goto } from '$app/navigation';
  import AuthCard from '$lib/components/AuthCard.svelte';
  import ErrorAlert from '$lib/components/ErrorAlert.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { localizedHref } from '$lib/i18n.svelte';
  import * as m from '$lib/paraglide/messages';

  let username = $state('');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let err = $state('');
  let loading = $state(false);

  // A signed-in visitor has nothing to do here; send them home instead of
  // showing a registration form for a new account they don't need.
  $effect(() => {
    if ($user) {
      void goto(localizedHref('/'), { replaceState: true });
    }
  });

  async function handleRegister(e: SubmitEvent) {
    e.preventDefault();
    err = '';

    if (password !== confirmPassword) {
      err = m.register_error_mismatch();
      return;
    }

    loading = true;
    try {
      await register(username, email, password);
      await goto(localizedHref('/'));
    } catch (error) {
      err = localizeApiError(error, () => m.register_error_unknown());
    } finally {
      loading = false;
    }
  }
</script>

<AuthCard title={m.register_title()} subtitle={m.register_subtitle()}>
  <form onsubmit={handleRegister} class="auth-form">
    <label class="field">
      <span class="label-text">{m.register_username_label()}</span>
      <input
        type="text"
        bind:value={username}
        class="input"
        placeholder={m.register_username_placeholder()}
        autocomplete="username"
        minlength="3"
        maxlength="16"
        required
      />
    </label>

    <label class="field">
      <span class="label-text">{m.register_email_label()}</span>
      <input
        type="email"
        bind:value={email}
        class="input"
        placeholder={m.register_email_placeholder()}
        autocomplete="email"
        required
      />
    </label>

    <div class="field">
      <label for="register-password" class="label-text">{m.register_password_label()}</label>
      <PasswordInput
        id="register-password"
        bind:value={password}
        placeholder={m.register_password_placeholder()}
        autocomplete="new-password"
        minlength={8}
        required
        showLabel={m.register_password_show()}
        hideLabel={m.register_password_hide()}
      />
    </div>

    <div class="field">
      <label for="register-confirm-password" class="label-text">{m.register_confirm_label()}</label>
      <PasswordInput
        id="register-confirm-password"
        bind:value={confirmPassword}
        placeholder={m.register_confirm_placeholder()}
        autocomplete="new-password"
        minlength={8}
        required
        showLabel={m.register_confirm_show()}
        hideLabel={m.register_confirm_hide()}
      />
    </div>

    {#if err}
      <ErrorAlert message={err} />
    {/if}

    <button type="submit" class="btn-primary" disabled={loading}>
      {loading ? m.register_submitting() : m.register_submit()}
    </button>
  </form>

  {#snippet footer()}
    {m.register_has_account()}
    <a href={localizedHref('/login')} class="link">{m.register_login_link()}</a>
  {/snippet}
</AuthCard>

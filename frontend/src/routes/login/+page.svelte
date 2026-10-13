<script lang="ts">
  import { login, user } from '$lib/auth';
  import { localizeApiError } from '$lib/errorLocalization';
  import { goto } from '$app/navigation';
  import AuthCard from '$lib/components/AuthCard.svelte';
  import ErrorAlert from '$lib/components/ErrorAlert.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { localizedHref } from '$lib/i18n.svelte';
  import * as m from '$lib/paraglide/messages';

  let username = $state('');
  let password = $state('');
  let err = $state('');
  let loading = $state(false);

  // A signed-in visitor has nothing to do here; send them home instead of
  // showing a login form for an account they're already in.
  $effect(() => {
    if ($user) {
      void goto(localizedHref('/'), { replaceState: true });
    }
  });

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    err = '';
    loading = true;
    try {
      await login(username, password);
      await goto(localizedHref('/'));
    } catch (error) {
      err = localizeApiError(error, () => m.login_error_unknown());
    } finally {
      loading = false;
    }
  }
</script>

<AuthCard title={m.login_title()} subtitle={m.login_subtitle()}>
  <form onsubmit={handleLogin} class="auth-form">
    <label class="field">
      <span class="label-text">{m.login_username_label()}</span>
      <input
        type="text"
        bind:value={username}
        class="input"
        placeholder={m.login_username_placeholder()}
        autocomplete="username"
        required
      />
    </label>

    <div class="field">
      <label for="login-password" class="label-text">{m.login_password_label()}</label>
      <PasswordInput
        id="login-password"
        bind:value={password}
        placeholder={m.login_password_placeholder()}
        autocomplete="current-password"
        required
        showLabel={m.login_password_show()}
        hideLabel={m.login_password_hide()}
      />
    </div>

    {#if err}
      <ErrorAlert message={err} />
    {/if}

    <button type="submit" class="btn-primary" disabled={loading}>
      {loading ? m.login_submitting() : m.login_submit()}
    </button>
  </form>

  {#snippet footer()}
    {m.login_no_account()}
    <a href={localizedHref('/register')} class="link">{m.login_register_link()}</a>
  {/snippet}
</AuthCard>

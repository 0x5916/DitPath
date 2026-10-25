<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { login, user, AuthStorageError, isAuthSessionCurrent } from '#lib/auth.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { goto } from '$app/navigation';
  import AuthCard from '#lib/components/AuthCard.svelte';
  import GoogleSignIn from '#lib/components/GoogleSignIn.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import PasswordInput from '#lib/components/PasswordInput.svelte';
  import { localizedHref } from '#lib/i18n.svelte.ts';
  import * as m from '#lib/paraglide/messages.js';

  const scope = createSessionScope();
  onDestroy(scope.dispose);

  let username = $state('');
  let password = $state('');
  let err = $state('');
  let loading = $state(false);
  let authRevision = $state(0);

  // A signed-in visitor has nothing to do here; send them home instead of
  // showing a login form for an account they're already in.
  $effect(() => {
    if ($user) {
      void goto(localizedHref('/'), { replace: true });
    }
  });

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    let current = scope.begin();
    err = '';
    loading = true;
    authRevision += 1;
    try {
      await login(username, password);
    } catch (error) {
      if (
        error instanceof AuthStorageError &&
        error.session &&
        isAuthSessionCurrent(error.session)
      ) {
        current = scope.capture();
      }
      if (!current() || (error instanceof Error && error.name === 'AbortError')) return;
      err = localizeApiError(error, () => m.login_error_unknown());
    } finally {
      if (current()) loading = false;
    }
  }
</script>

<AuthCard title={m.login_title()} subtitle={m.login_subtitle()}>
  {#key authRevision}
    <GoogleSignIn disabled={loading} />
  {/key}
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

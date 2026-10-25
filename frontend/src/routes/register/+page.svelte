<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createSessionScope } from '#lib/session-scope.ts';
  import { register, user, AuthStorageError, isAuthSessionCurrent } from '#lib/auth.ts';
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
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let err = $state('');
  let loading = $state(false);
  let authRevision = $state(0);

  // A signed-in visitor has nothing to do here; send them home instead of
  // showing a registration form for a new account they don't need.
  $effect(() => {
    if ($user) {
      void goto(localizedHref('/'), { replace: true });
    }
  });

  async function handleRegister(e: SubmitEvent) {
    e.preventDefault();
    if (loading) return;
    let current = scope.begin();
    err = '';

    if (password !== confirmPassword) {
      err = m.register_error_mismatch();
      return;
    }

    loading = true;
    authRevision += 1;
    try {
      await register(username, email, password);
    } catch (error) {
      if (
        error instanceof AuthStorageError &&
        error.session &&
        isAuthSessionCurrent(error.session)
      ) {
        current = scope.capture();
      }
      if (!current() || (error instanceof Error && error.name === 'AbortError')) return;
      err = localizeApiError(error, () => m.register_error_unknown());
    } finally {
      if (current()) loading = false;
    }
  }
</script>

<AuthCard title={m.register_title()} subtitle={m.register_subtitle()}>
  {#key authRevision}
    <GoogleSignIn disabled={loading} />
  {/key}
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

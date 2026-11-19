<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';
  import {
    createGoogleSignInFlow,
    renderGoogleButton,
    type GoogleFlowState
  } from '#lib/google-sign-in.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import { AUTH_STORAGE_KEYS } from '#lib/storageKeys.ts';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import RegistrationUsername from '#lib/components/RegistrationUsername.svelte';
  import * as m from '#lib/paraglide/messages.js';

  let {
    disabled,
    authRevision,
    passwordForm
  }: { disabled: boolean; authRevision: number; passwordForm: Snippet } = $props();
  let flowState = $state<GoogleFlowState>({ busy: false, needsUsername: false, error: null });
  let username = $state('');
  let buttonState = $state<'loading' | 'ready' | 'failed'>('loading');
  let flow: ReturnType<typeof createGoogleSignInFlow> | undefined;
  let googleRegion: HTMLDivElement;
  let buttonHost: HTMLElement;

  function focusGoogleButton() {
    const target =
      buttonHost.querySelector<HTMLElement>('iframe') ??
      buttonHost.querySelector<HTMLElement>('button, [role="button"]');
    (target ?? buttonHost).focus();
  }

  async function cancelUsername() {
    flow?.cancel();
    username = '';
    await tick();
    if (buttonHost.isConnected) focusGoogleButton();
  }

  function retryButton() {
    googleRegion.focus();
    buttonState = 'loading';
  }

  function mountGoogleButton(container: HTMLElement) {
    const controller = new AbortController();
    let mountedFlow: typeof flow;
    buttonHost = container;
    buttonState = 'loading';
    flowState = { busy: false, needsUsername: false, error: null };
    async function load() {
      try {
        const nextFlow = createGoogleSignInFlow((value) => {
          flowState = value;
        });
        flow = mountedFlow = nextFlow;
        await renderGoogleButton(container, {
          clientId: PUBLIC_GOOGLE_CLIENT_ID,
          nonce: nextFlow.nonce,
          locale: getLocale(),
          fullWidth: true,
          signal: controller.signal,
          begin: () => nextFlow.begin(),
          receive: (credential) => void nextFlow.receive(credential)
        });
        if (controller.signal.aborted) return;
        buttonState = 'ready';
        if (document.activeElement === googleRegion) focusGoogleButton();
      } catch {
        if (!controller.signal.aborted) buttonState = 'failed';
      }
    }
    void load();
    return () => {
      controller.abort();
      mountedFlow?.dispose();
    };
  }
</script>

<svelte:window
  onstorage={(event) => {
    if (event.key === null || Object.values(AUTH_STORAGE_KEYS).some((key) => key === event.key))
      flow?.cancel();
  }}
/>

<div
  bind:this={googleRegion}
  class="google-sign-in"
  role="group"
  aria-label={m.settings_google_title()}
  aria-busy={flowState.busy}
  tabindex="-1"
>
  {#if buttonState === 'failed'}
    <ErrorAlert message={m.google_unavailable()} />
    <button class="btn-ghost" type="button" onclick={retryButton} {disabled}
      >{m.common_retry()}</button
    >
  {:else}
    <div inert={disabled || flowState.busy} hidden={flowState.needsUsername}>
      {#key authRevision}
        <div {@attach mountGoogleButton} class="google-button" tabindex="-1"></div>
      {/key}
      {#if buttonState === 'loading'}<p class="body-text" role="status">
          {m.google_loading()}
        </p>{/if}
    </div>
  {/if}
  {#if flowState.needsUsername}
    <form
      class="auth-form"
      onsubmit={(event) => {
        event.preventDefault();
        void flow?.register(username);
      }}
    >
      <RegistrationUsername
        label={m.google_choose_username()}
        bind:value={username}
        disabled={disabled || flowState.busy}
        focusOnMount
      />
      <button class="btn-primary" type="submit" disabled={disabled || flowState.busy}>
        {flowState.busy ? m.register_submitting() : m.google_create_account()}
      </button>
      <button
        class="btn-ghost"
        type="button"
        onclick={cancelUsername}
        disabled={disabled || flowState.busy}
      >
        {m.google_cancel()}
      </button>
    </form>
  {/if}
  {#if flowState.error}
    <ErrorAlert message={localizeApiError(flowState.error, () => m.google_unavailable())} />
  {/if}
</div>

{#if !flowState.needsUsername}
  {#if buttonState === 'ready'}<p class="login-divider">{m.login_or()}</p>{/if}
  {@render passwordForm()}
{/if}

<style>
  .google-sign-in {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .google-button {
    display: flex;
    justify-content: center;
  }
  .google-button:not(:empty) {
    min-height: 44px;
  }
  .login-divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-5);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .login-divider::before,
  .login-divider::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
</style>

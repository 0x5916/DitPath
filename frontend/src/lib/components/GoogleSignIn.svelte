<script lang="ts">
  import { PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';
  import {
    createGoogleSignInFlow,
    loadGoogleIdentity,
    type GoogleFlowState
  } from '#lib/google-sign-in.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import { AUTH_STORAGE_KEYS } from '#lib/storageKeys.ts';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import * as m from '#lib/paraglide/messages.js';

  let { disabled = false }: { disabled?: boolean } = $props();
  let flowState = $state<GoogleFlowState>({ busy: false, needsUsername: false, error: null });
  let username = $state('');
  let loading = $state(true);
  let flow: ReturnType<typeof createGoogleSignInFlow> | undefined;

  function mountGoogleButton(container: HTMLElement) {
    if (!PUBLIC_GOOGLE_CLIENT_ID) return;
    let alive = true;
    try {
      flow = createGoogleSignInFlow((value) => {
        flowState = value;
      });
      const mountedFlow = flow;
      void loadGoogleIdentity()
        .then((google) => {
          if (!alive) return;
          google.initialize({
            client_id: PUBLIC_GOOGLE_CLIENT_ID,
            nonce: mountedFlow.nonce,
            callback: ({ credential }) => {
              void mountedFlow.receive(credential);
            },
            auto_select: false,
            ux_mode: 'popup'
          });
          google.renderButton(container, {
            type: 'standard',
            size: 'large',
            text: 'continue_with',
            theme: 'outline',
            locale: getLocale(),
            click_listener: () => mountedFlow.begin()
          });
          loading = false;
        })
        .catch((error: unknown) => {
          if (alive) {
            loading = false;
            flowState = { busy: false, needsUsername: false, error };
          }
        });
    } catch (error) {
      loading = false;
      flowState = { busy: false, needsUsername: false, error };
    }
    return () => {
      alive = false;
      flow?.dispose();
    };
  }
</script>

<svelte:window
  onstorage={(event) => {
    if (event.key === null || Object.values(AUTH_STORAGE_KEYS).some((key) => key === event.key))
      flow?.cancel();
  }}
/>

{#if PUBLIC_GOOGLE_CLIENT_ID}
  <div class="google-sign-in" aria-busy={flowState.busy}>
    <div inert={disabled || flowState.busy} hidden={flowState.needsUsername}>
      <div {@attach mountGoogleButton} class="google-button"></div>
      {#if loading}<p class="body-text" role="status">{m.google_loading()}</p>{/if}
    </div>
    {#if flowState.needsUsername}
      <form
        class="auth-form"
        onsubmit={(event) => {
          event.preventDefault();
          void flow?.register(username);
        }}
      >
        <label class="field">
          <span class="label-text">{m.google_choose_username()}</span>
          <input
            class="input"
            bind:value={username}
            autocomplete="username"
            minlength="3"
            maxlength="16"
            required
            disabled={disabled || flowState.busy}
          />
        </label>
        <button class="btn-primary" type="submit" disabled={disabled || flowState.busy}>
          {flowState.busy ? m.register_submitting() : m.google_create_account()}
        </button>
        <button
          class="btn-ghost"
          type="button"
          onclick={() => flow?.cancel()}
          disabled={flowState.busy}>{m.google_cancel()}</button
        >
      </form>
    {/if}
    {#if flowState.error}
      <ErrorAlert message={localizeApiError(flowState.error, () => m.google_unavailable())} />
    {/if}
  </div>
{/if}

<style>
  .google-sign-in {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .google-button {
    display: flex;
    justify-content: center;
    min-height: 44px;
  }
</style>

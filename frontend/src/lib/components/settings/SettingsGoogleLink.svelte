<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CircleCheck } from '@lucide/svelte';
  import { PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';
  import {
    AuthStorageError,
    getAuthSession,
    isAuthSessionCurrent,
    type AuthSession
  } from '#lib/auth.ts';
  import {
    linkGoogleAccount,
    requestGoogleLinkChallenge,
    type GoogleLinkChallenge
  } from '#lib/api.ts';
  import { renderGoogleButton } from '#lib/google-sign-in.ts';
  import { extractErrorCode } from '#lib/errorCode.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { AUTH_STORAGE_KEYS } from '#lib/storageKeys.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import * as m from '#lib/paraglide/messages.js';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';

  let { username, linked, onlinked }: { username: string; linked: boolean; onlinked: () => void } =
    $props();
  const instructionId = $props.id();
  let step = $state<'idle' | 'starting' | 'choose' | 'confirm' | 'saving'>('idle');
  let password = $state('');
  let error = $state('');
  let buttonLoading = $state(false);
  let heading: HTMLHeadingElement;
  let proof: GoogleLinkChallenge | undefined;
  let credential = '';
  let session: AuthSession;
  let controller: AbortController | undefined;

  function reset() {
    controller?.abort();
    controller = undefined;
    proof = undefined;
    credential = '';
    password = '';
    error = '';
    step = 'idle';
  }
  onDestroy(reset);

  function current(request: AbortController) {
    if (request.signal.aborted) return false;
    try {
      if (isAuthSessionCurrent(session)) return true;
      reset();
    } catch (failure) {
      fail(new AuthStorageError(failure));
    }
    return false;
  }

  function fail(failure: unknown) {
    reset();
    const code = extractErrorCode(failure);
    if (code === 'GOOGLE_ACCOUNT_CONFLICT') error = m.settings_google_conflict();
    else if (code === 'GOOGLE_CREDENTIAL_INVALID') error = m.settings_google_restart();
    else if (code === 'GOOGLE_SIGN_IN_UNAVAILABLE' || code === 'GOOGLE_SIGN_IN_DISABLED')
      error = m.settings_google_unavailable();
    else error = localizeApiError(failure, m.settings_google_unavailable);
    heading.focus();
  }

  async function start() {
    reset();
    const request = new AbortController();
    controller = request;
    step = 'starting';
    heading.focus();
    try {
      session = getAuthSession();
      if (session.username !== username) {
        reset();
        return;
      }
      const result = await requestGoogleLinkChallenge(session, request.signal);
      if (!current(request)) return;
      proof = result;
      buttonLoading = true;
      step = 'choose';
    } catch (failure) {
      if (request.signal.aborted) return;
      if (failure instanceof Error && failure.name === 'AbortError') reset();
      else fail(failure);
    }
  }

  function mountButton(container: HTMLElement) {
    const request = controller;
    if (!request || !proof) return;
    let clicked = false;
    void renderGoogleButton(container, {
      clientId: PUBLIC_GOOGLE_CLIENT_ID,
      nonce: proof.nonce,
      locale: getLocale(),
      signal: request.signal,
      begin: () => {
        clicked = true;
      },
      receive: (value) => {
        if (!clicked || step !== 'choose' || !current(request)) return;
        if (!value) {
          fail(new Error('GOOGLE_CREDENTIAL_INVALID'));
          return;
        }
        credential = value;
        step = 'confirm';
      }
    })
      .then(() => {
        if (current(request)) buttonLoading = false;
      })
      .catch((failure: unknown) => {
        if (current(request)) fail(failure);
      });
  }

  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    const request = controller;
    if (!request || !proof || !current(request) || step !== 'confirm' || !password) return;
    step = 'saving';
    error = '';
    const submission = { current_password: password, challenge: proof.challenge, credential };
    password = '';
    try {
      await linkGoogleAccount(session, request.signal, submission);
      if (!current(request)) return;
      reset();
      onlinked();
      heading.focus();
    } catch (failure) {
      if (!current(request)) return;
      if (extractErrorCode(failure) === 'INVALID_CREDENTIALS') {
        error = m.settings_google_wrong_password();
        step = 'confirm';
      } else {
        fail(failure);
      }
    }
  }
</script>

<svelte:window
  onstorage={(event) => {
    if (event.key === null || Object.values(AUTH_STORAGE_KEYS).some((key) => key === event.key))
      reset();
  }}
/>

<section class="panel panel--ledger google-link">
  <h2 class="card-title" bind:this={heading} tabindex="-1">{m.settings_google_title()}</h2>
  {#if linked}
    <p class="body-text linked-status" role="status">
      <CircleCheck size={16} aria-hidden="true" />
      {m.settings_google_linked()}
    </p>
  {:else}
    {#if step === 'idle'}
      <button type="button" class="btn-ghost" onclick={start}>{m.settings_google_link()}</button>
    {:else if step === 'confirm' || step === 'saving'}
      <form class="google-link" onsubmit={confirm}>
        <p id={instructionId} class="body-text">{m.settings_google_confirm({ username })}</p>
        <label class="field">
          <span class="label-text">{m.settings_current_password_label()}</span>
          <input
            class="input"
            type="password"
            autocomplete="current-password"
            aria-describedby={error ? `${instructionId} ${instructionId}-error` : instructionId}
            aria-invalid={error ? true : undefined}
            required
            bind:value={password}
            {@attach (element) => {
              if (step === 'confirm') element.focus();
            }}
            disabled={step === 'saving'}
          />
        </label>
        <button type="submit" class="btn-primary" disabled={!password || step === 'saving'}>
          {step === 'saving' ? m.settings_saving() : m.settings_google_link()}
        </button>
      </form>
    {:else}
      {#if step === 'starting' || buttonLoading}<p class="body-text" role="status">
          {m.google_loading()}
        </p>{/if}
      {#if step === 'choose'}<div {@attach mountButton}></div>{/if}
    {/if}
    {#if step !== 'idle' && step !== 'saving'}<button
        type="button"
        class="btn-ghost"
        onclick={() => {
          reset();
          heading.focus();
        }}>{m.google_cancel()}</button
      >{/if}
    {#if error}<div id="{instructionId}-error"><ErrorAlert message={error} /></div>{/if}
  {/if}
</section>

<style>
  .google-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }

  .google-link > button {
    justify-self: start;
  }

  .linked-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>

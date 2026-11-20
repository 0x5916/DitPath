<script lang="ts">
  import { onDestroy, tick, type Snippet } from 'svelte';
  import { CircleAlert, CircleCheck } from '@lucide/svelte';
  import { PUBLIC_GOOGLE_CLIENT_ID } from '$app/env/public';
  import { assertAuthSessionCurrent, getAuthSession, type AuthSession } from '#lib/auth.ts';
  import { requestDeletionChallenge, type AccountDeletionProof } from '#lib/api.ts';
  import { renderGoogleButton } from '#lib/google-sign-in.ts';
  import { getTrainingOwner } from '#lib/training-owner.ts';
  import { extractErrorCode } from '#lib/errorCode.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import * as m from '#lib/paraglide/messages.js';

  let {
    detail = false,
    passwordEnabled,
    onexport,
    onreset,
    ondelete
  }: {
    detail?: boolean;
    passwordEnabled: boolean;
    onexport: (signal: AbortSignal) => Promise<void>;
    onreset: (signal: AbortSignal) => Promise<void>;
    ondelete: (
      session: AuthSession,
      signal: AbortSignal,
      proof: AccountDeletionProof
    ) => Promise<void>;
  } = $props();

  const session = getAuthSession();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let mounted = true;
  let invoker: HTMLElement | undefined;
  let action = $state<'reset' | 'delete'>();
  let attempt = $state.raw<AbortController>();
  let exportAttempt = $state.raw<AbortController>();
  let googleProof = $state.raw<{ credential: string; challenge: string }>();
  let googleLoading = $state(false);
  let password = $state('');
  let acknowledged = $state(false);
  let submitting = $state(false);
  let dialogError = $state('');
  let exportError = $state('');
  let resetSuccess = $state(false);
  let resetOwner = '';
  let resetExpired = $state(false);

  const resetting = $derived(action === 'reset');
  const ready = $derived(
    resetting ? acknowledged && !resetExpired : passwordEnabled ? !!password : !!googleProof
  );

  function discardConfirmation() {
    attempt?.abort();
    attempt = undefined;
    googleProof = undefined;
    acknowledged = false;
    password = '';
  }

  onDestroy(() => {
    mounted = false;
    exportAttempt?.abort();
    if (!submitting) discardConfirmation();
  });

  async function exportData() {
    if (exportAttempt) return;
    const request = new AbortController();
    exportAttempt = request;
    exportError = '';
    try {
      assertAuthSessionCurrent(session);
      await onexport(request.signal);
    } catch (error) {
      if (!request.signal.aborted)
        exportError = localizeApiError(error, m.settings_account_data_export_error);
    } finally {
      if (!request.signal.aborted) exportAttempt = undefined;
    }
  }

  async function open(kind: 'reset' | 'delete', button: HTMLElement) {
    if (attempt) return;
    const request = new AbortController();
    attempt = request;
    action = kind;
    invoker = button;
    dialogError = '';
    if (kind === 'reset') {
      resetSuccess = resetExpired = false;
      resetOwner = getTrainingOwner();
    }
    await tick();
    if (!request.signal.aborted) dialog.showModal();
  }

  function close() {
    dialog.close();
    invoker?.focus();
    invoker = undefined;
    action = undefined;
    discardConfirmation();
  }

  async function loadGoogleButton(container: HTMLElement, request: AbortController) {
    const { signal } = request;
    googleLoading = true;
    try {
      if (!PUBLIC_GOOGLE_CLIENT_ID) throw new Error('GOOGLE_SIGN_IN_DISABLED');
      const { challenge, nonce } = await requestDeletionChallenge(session, signal);
      if (signal.aborted) return;
      let clicked = false;
      await renderGoogleButton(container, {
        clientId: PUBLIC_GOOGLE_CLIENT_ID,
        nonce,
        locale: getLocale(),
        fullWidth: true,
        signal,
        begin: () => {
          clicked = true;
        },
        receive(credential) {
          if (!clicked || !credential || signal.aborted || submitting || googleProof) return;
          googleProof = { challenge, credential };
          dialog.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
        }
      });
    } catch (error) {
      if (!signal.aborted) {
        const code = extractErrorCode(error);
        dialogError =
          code === 'GOOGLE_SIGN_IN_DISABLED' || code === 'GOOGLE_SIGN_IN_UNAVAILABLE'
            ? m.settings_account_data_google_unavailable()
            : localizeApiError(error, m.settings_account_data_google_unavailable);
      }
    } finally {
      if (!signal.aborted) googleLoading = false;
    }
  }

  function retryGoogle() {
    discardConfirmation();
    dialogError = '';
    attempt = new AbortController();
  }

  async function confirm() {
    const request = attempt;
    if (!request || !ready || submitting) return;

    const isReset = resetting;
    const selected = googleProof;
    const currentPassword = password;
    const fallback = isReset
      ? m.settings_account_data_reset_error
      : m.settings_account_data_delete_error;
    submitting = true;
    dialogError = '';
    password = '';

    try {
      assertAuthSessionCurrent(session);
      if (isReset) {
        if (getTrainingOwner() !== resetOwner) throw new Error('TRAINING_PROGRESS_CHANGED');
        await onreset(request.signal);
      } else
        await ondelete(session, request.signal, selected ?? { current_password: currentPassword });
      if (!mounted || request.signal.aborted) return;
      resetSuccess = isReset;
      close();
    } catch (error) {
      if (!mounted || request.signal.aborted) return;
      dialogError =
        !isReset && passwordEnabled && extractErrorCode(error) === 'INVALID_CREDENTIALS'
          ? m.settings_google_wrong_password()
          : localizeApiError(error, fallback);
      if (isReset) {
        acknowledged = false;
        resetExpired = getTrainingOwner() !== resetOwner;
        if (resetExpired) dialogError = m.settings_account_data_reset_changed();
      }
      if (selected) {
        discardConfirmation();
        attempt = new AbortController();
      }
    } finally {
      submitting = false;
      if (!mounted) discardConfirmation();
    }
  }
</script>

{#snippet row(title: string, description: string, button: Snippet)}
  <div class="data-row">
    <div>
      <svelte:element this={detail ? 'h2' : 'h3'} class="action-title">{title}</svelte:element>
      <p class="description">{description}</p>
    </div>
    {@render button()}
  </div>
{/snippet}

{#snippet errorNotice(message: string, noticeId?: string)}
  <p id={noticeId} class="feedback danger" role="alert">
    <CircleAlert size={16} aria-hidden="true" />
    {message}
  </p>
{/snippet}

<section id="account-data" class="panel panel--ledger" aria-labelledby={`${id}-heading`}>
  <svelte:element
    this={detail ? 'h1' : 'h2'}
    id={`${id}-heading`}
    class={detail ? 'page-title' : 'card-title'}>{m.settings_account_data_title()}</svelte:element
  >
  <div class="data-item">
    {#snippet download()}
      <button class="btn-ghost" type="button" disabled={!!exportAttempt} onclick={exportData}>
        {exportAttempt
          ? m.settings_account_data_export_pending()
          : m.settings_account_data_export()}
      </button>
    {/snippet}
    {@render row(
      m.settings_account_data_export_title(),
      m.settings_account_data_export_description(),
      download
    )}
    {#if exportError}{@render errorNotice(exportError)}{/if}
  </div>
  <div class="data-item">
    {#snippet reset()}
      <button
        class="btn-ghost danger"
        type="button"
        aria-haspopup="dialog"
        onclick={(event) => open('reset', event.currentTarget)}
        >{m.settings_account_data_reset()}</button
      >
    {/snippet}
    {@render row(
      m.settings_account_data_reset(),
      m.settings_account_data_reset_description(),
      reset
    )}
    {#if resetSuccess}
      <p class="feedback success" role="status">
        <CircleCheck size={16} aria-hidden="true" />
        {m.settings_account_data_reset_success()}
      </p>
    {/if}
  </div>
  <div class="data-item">
    {#snippet remove()}
      <button
        class="btn-ghost danger"
        type="button"
        aria-haspopup="dialog"
        onclick={(event) => open('delete', event.currentTarget)}
        >{m.settings_account_data_delete()}</button
      >
    {/snippet}
    {@render row(
      m.settings_account_data_delete(),
      m.settings_account_data_delete_description(),
      remove
    )}
  </div>
</section>

<dialog
  bind:this={dialog}
  role="alertdialog"
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-scope`}
  aria-busy={submitting}
  oncancel={(event) => {
    event.preventDefault();
    if (!submitting) close();
  }}
>
  {#if action && attempt}
    <h2 id={`${id}-title`} class="section-title">
      {resetting ? m.settings_account_data_reset_title() : m.settings_account_data_delete_title()}
    </h2>
    <p id={`${id}-scope`} class="description">
      {resetting
        ? m.settings_account_data_reset_warning()
        : m.settings_account_data_delete_warning()}
    </p>
    {#if resetting}
      <label class="acknowledgement">
        <input type="checkbox" bind:checked={acknowledged} disabled={submitting || resetExpired} />
        {m.settings_account_data_reset_ack()}
      </label>
    {:else if passwordEnabled}
      <label class="field">
        <span class="label-text">{m.settings_current_password_label()}</span>
        <input
          class="input"
          aria-invalid={dialogError ? true : undefined}
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={submitting}
          aria-describedby={dialogError ? `${id}-error` : undefined}
        />
      </label>
    {:else}
      <p class="label-text">{m.settings_account_data_google_instruction()}</p>
      {#if googleProof}
        <p class="feedback success" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          {m.settings_account_data_google_selected()}
        </p>
      {:else if dialogError}
        {#if PUBLIC_GOOGLE_CLIENT_ID}
          <button type="button" class="btn-ghost" onclick={retryGoogle}>{m.common_retry()}</button>
        {/if}
      {:else}
        {#key attempt}
          {@const request = attempt}
          <div
            {@attach (element) => {
              void loadGoogleButton(element, request);
            }}
          ></div>
          {#if googleLoading}<span class="description" role="status">{m.google_loading()}</span
            >{/if}
        {/key}
      {/if}
    {/if}
    {#if dialogError}{@render errorNotice(dialogError, `${id}-error`)}{/if}
    <div class="dialog-actions">
      <!-- svelte-ignore a11y_autofocus (initial focus goes to the safest action) -->
      <button class="btn-ghost" type="button" autofocus disabled={submitting} onclick={close}>
        {m.forum_cancel()}
      </button>
      <button
        class="btn-primary confirm"
        type="button"
        disabled={!ready || submitting}
        onclick={confirm}
      >
        {resetting
          ? submitting
            ? m.settings_account_data_reset_pending()
            : m.settings_account_data_reset()
          : submitting
            ? m.settings_account_data_delete_pending()
            : m.settings_account_data_delete()}
      </button>
    </div>
  {/if}
</dialog>

<style>
  .data-item {
    padding-block: var(--space-3);
  }
  .data-item + .data-item {
    border-block-start: 1px solid var(--border);
  }
  .data-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(9.375rem, auto);
    align-items: center;
    gap: var(--space-4);
  }
  .action-title,
  .description,
  .feedback {
    margin: 0;
    font-size: var(--text-sm);
  }
  .action-title {
    margin-block-end: var(--space-1);
    font-weight: 600;
  }
  .description {
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }
  .danger {
    color: var(--danger);
  }
  .success {
    color: var(--status-good);
  }
  .feedback {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .feedback :global(svg) {
    flex: none;
    align-self: center;
  }
  .data-item .feedback {
    margin-block-start: var(--space-2);
  }
  dialog {
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-6);
    margin: auto;
    width: min(26rem, calc(100% - 2 * var(--space-4)));
    max-height: calc(100dvh - 2 * var(--space-4));
    overflow: auto;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--bg-base) 70%, transparent);
  }
  .section-title {
    margin: 0;
    font-size: var(--text-lg);
  }
  .acknowledgement {
    display: flex;
    min-height: var(--nav-control-height);
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }
  .acknowledgement input {
    flex: none;
    width: 1.125rem;
    height: 1.125rem;
    accent-color: var(--accent);
  }
  .input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .dialog-actions button {
    min-height: var(--answer-target-min);
  }
  .confirm {
    background: var(--danger);
    color: var(--bg-surface);
    transition: none;
  }
  .confirm:hover {
    background: color-mix(in srgb, var(--danger) 90%, var(--bg-surface));
  }
  .confirm:disabled {
    opacity: 1;
    background: var(--bg-inset);
    border-color: var(--border);
    color: var(--text-secondary);
  }
  @media (max-width: 720px) {
    .data-row {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
    }
    .dialog-actions {
      flex-direction: column;
    }
  }
</style>

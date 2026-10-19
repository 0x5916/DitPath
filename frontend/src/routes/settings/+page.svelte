<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { getAuthSession, user } from '#lib/auth.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import {
    saveCWSettings,
    getUserInfo,
    updateCallSign,
    updateEmail,
    sendVerificationEmail,
    verifyEmail,
    updatePassword,
    savePageSettings,
    type PageSettings
  } from '#lib/api.ts';
  import { langPreference, setLangPreference } from '#lib/i18n.svelte.ts';
  import { locales } from '#lib/paraglide/runtime.js';
  import {
    getLocaleLongLabel,
    normalizeLocalePreference,
    type LocalePreference
  } from '#lib/locale.ts';
  import { LESSONS } from '#lib/morse.ts';
  import {
    applyClientPageSettings,
    applyPageLanguagePreference,
    normalizeLesson,
    readClientCwSettings,
    readClientPageSettings,
    readStoredLesson,
    restoreSettingsFromServer,
    saveClientCwSettings
  } from '#lib/cwSync.ts';
  import { localizeApiError } from '#lib/errorLocalization.ts';
  import { createWebAudioEngine, type AudioEngine } from '#lib/audio/engine.ts';
  import { buildAudioPlan } from '#lib/training/timing.ts';
  import { openTrainingDb, closeTrainingDb, clearTrainingCache } from '#lib/data/training-db.ts';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import SaveButton from '#lib/components/SaveButton.svelte';
  import { Volume2, Trash2 } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';

  // Account section
  let username = $state('');
  let callSign = $state('');
  let initialCallSign = $state('');
  let callSignSaving = $state(false);
  let callSignError = $state('');
  let callSignSaved = $state(false);
  let email = $state('');
  let initialEmail = $state('');
  let emailVerified = $state(false);
  let emailSaving = $state(false);
  let emailError = $state('');
  let emailSaved = $state(false);
  let verificationCode = $state('');
  let verificationSendLoading = $state(false);
  let verificationSendError = $state('');
  let verificationSent = $state(false);
  let verificationCheckLoading = $state(false);
  let verificationCheckError = $state('');
  let verificationSuccess = $state(false);

  // Password section
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let passwordSaving = $state(false);
  let passwordError = $state('');
  let passwordSaved = $state(false);

  // Page settings section
  let pageLanguage = $state<LocalePreference>(langPreference.value);
  let pageLesson = $state(1);
  let initialPageLesson = $state(1);
  let pageSaving = $state(false);
  let pageError = $state('');
  let pageSaved = $state(false);

  // CW Settings section
  let charWpm = $state(20);
  let initialCharWpm = $state(20);
  let effWpm = $state(12);
  let initialEffWpm = $state(12);
  let freq = $state(600);
  let initialFreq = $state(600);
  let startDelay = $state(0);
  let initialStartDelay = $state(0);
  let cwSaving = $state(false);
  let cwError = $state('');
  let cwSaved = $state(false);

  let loading = $state(true);
  let loadError = $state('');
  let lastAuthLoaded: string | null = null;
  const sessionScope = createSessionScope();
  const timers = new SvelteSet<ReturnType<typeof setTimeout>>();
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
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

  let confirmClearOpen = $state(false);
  let clearSuccess = $state(false);
  let clearing = $state(false);
  let clearBlocked = $state(false);
  let clearError = $state('');

  let toneAudio: AudioEngine | null = null;
  const canTestTone = $derived(
    Number.isFinite(freq) &&
      freq >= 300 &&
      freq <= 2000 &&
      Number.isFinite(charWpm) &&
      charWpm >= 5 &&
      charWpm <= 50 &&
      Number.isFinite(effWpm) &&
      effWpm >= 5 &&
      effWpm <= 50
  );

  onMount(() => {
    toneAudio = createWebAudioEngine();
    return () => {
      void toneAudio?.dispose();
      toneAudio = null;
    };
  });

  function playTestTone() {
    if (!toneAudio || !canTestTone) return;
    try {
      const plan = buildAudioPlan('AAA', {
        frequency: freq,
        charWpm,
        effWpm: Math.min(effWpm, charWpm)
      });
      toneAudio.play(plan);
    } catch (err) {
      console.error('Failed to play test tone:', err);
    }
  }

  async function handleClearLocalData() {
    if (clearing) return;
    clearing = true;
    clearSuccess = false;
    clearBlocked = false;
    clearError = '';
    try {
      const db = await openTrainingDb();
      try {
        await clearTrainingCache(db);
      } finally {
        closeTrainingDb(db);
      }
      if (destroyed) return;
      confirmClearOpen = false;
      clearSuccess = true;
      later(() => (clearSuccess = false), 3000);
    } catch (error) {
      if (!destroyed)
        clearError =
          error instanceof Error &&
          error.message === 'Pending training uploads must be synchronized before clearing history'
            ? m.history_clear_pending()
            : m.settings_data_error();
    } finally {
      if (!destroyed) {
        clearing = false;
        clearBlocked = false;
      }
    }
  }

  const passwordDirty = $derived(
    currentPassword.trim() !== '' || newPassword.trim() !== '' || confirmPassword.trim() !== ''
  );
  const callSignDirty = $derived(callSign.trim().toUpperCase() !== initialCallSign);
  const emailDirty = $derived(email.trim() !== initialEmail.trim());
  const pageDirty = $derived(normalizeLesson(pageLesson, LESSONS.length) !== initialPageLesson);
  const cwDirty = $derived(
    charWpm !== initialCharWpm ||
      effWpm !== initialEffWpm ||
      freq !== initialFreq ||
      startDelay !== initialStartDelay
  );

  $effect(() => {
    const identity = JSON.stringify([getAuthSession().generation, $user?.username ?? null]);
    if (lastAuthLoaded === identity) return;
    lastAuthLoaded = identity;
    untrack(() => void loadAll());
  });

  function applyCwState(cw: {
    char_wpm: number;
    eff_wpm: number;
    freq: number;
    start_delay: number;
  }) {
    charWpm = cw.char_wpm;
    initialCharWpm = cw.char_wpm;
    effWpm = cw.eff_wpm;
    initialEffWpm = cw.eff_wpm;
    freq = cw.freq;
    initialFreq = cw.freq;
    startDelay = cw.start_delay;
    initialStartDelay = cw.start_delay;
  }

  function applyPageState(page: PageSettings) {
    pageLanguage = normalizeLocalePreference(page.language);
    pageLesson = normalizeLesson(page.cur_lesson, LESSONS.length);
    initialPageLesson = pageLesson;
  }

  function resetEmailVerificationState() {
    verificationCode = '';
    verificationSent = false;
    verificationSuccess = false;
    verificationSendError = '';
    verificationCheckError = '';
  }

  function showSavedFlag(setter: (value: boolean) => void, durationMs: number = 3000) {
    setter(true);
    later(() => setter(false), durationMs);
  }

  async function loadAll() {
    const current = sessionScope.begin();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    username = '';
    callSign = '';
    initialCallSign = '';
    email = '';
    initialEmail = '';
    emailVerified = false;
    currentPassword = '';
    newPassword = '';
    confirmPassword = '';
    callSignSaving = emailSaving = passwordSaving = pageSaving = cwSaving = false;
    callSignSaved = emailSaved = passwordSaved = pageSaved = cwSaved = false;
    callSignError = emailError = passwordError = pageError = cwError = '';
    verificationSendLoading = verificationCheckLoading = false;
    resetEmailVerificationState();
    if (!clearing) confirmClearOpen = false;
    clearSuccess = false;
    loading = true;
    loadError = '';

    if (!$user) {
      const localCw = readClientCwSettings();
      const localPage = readClientPageSettings(
        readStoredLesson(LESSONS.length),
        LESSONS.length,
        langPreference.value
      );

      applyCwState(localCw);
      applyPageState(localPage);

      loading = false;
      return;
    }

    try {
      const [info, settings] = await Promise.all([getUserInfo(), restoreSettingsFromServer()]);
      if (!current()) return;
      const { cw, page } = settings;
      username = info.username;
      callSign = (info.call_sign ?? '').trim().toUpperCase();
      initialCallSign = callSign;
      email = info.email;
      initialEmail = info.email;
      emailVerified = info.email_verified;
      resetEmailVerificationState();
      applyCwState(cw);
      applyPageState(page);
    } catch (e) {
      if (!current()) return;
      loadError = localizeApiError(e, () => m.settings_load_error());
    } finally {
      if (current()) loading = false;
    }
  }

  async function saveCallSign(e: SubmitEvent) {
    const current = sessionScope.capture();
    e.preventDefault();
    if (!callSignDirty || callSignSaving) return;
    const submitted = callSign.trim().toUpperCase();
    callSignSaving = true;
    callSignError = '';
    callSignSaved = false;
    try {
      await updateCallSign(submitted);
      if (!current()) return;
      initialCallSign = submitted;
      if (callSign.trim().toUpperCase() !== submitted) return;
      callSign = submitted;
      showSavedFlag((value) => {
        callSignSaved = value;
      });
    } catch (err) {
      if (!current()) return;
      callSignError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) callSignSaving = false;
    }
  }

  // Language applies immediately (the top bar's language menu and the phone More
  // hub work the same way): commit it and stamp the synced page-settings
  // timestamp through the shared helper. Save then covers the lesson only.
  function applyLanguageChange(next: LocalePreference) {
    pageLanguage = next;
    applyPageLanguagePreference(next, setLangPreference);
  }

  async function saveEmail(e: SubmitEvent) {
    const current = sessionScope.capture();
    e.preventDefault();
    if (!emailDirty || emailSaving || verificationSendLoading || verificationCheckLoading) return;
    const submitted = email.trim();
    emailSaving = true;
    emailError = '';
    emailSaved = false;
    try {
      await updateEmail(submitted);
      if (!current()) return;
      initialEmail = submitted;
      emailVerified = false;
      resetEmailVerificationState();
      if (email.trim() !== submitted) return;
      email = submitted;
      showSavedFlag((value) => {
        emailSaved = value;
      });
    } catch (err) {
      if (!current()) return;
      emailError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) emailSaving = false;
    }
  }

  async function requestEmailVerificationCode() {
    const current = sessionScope.capture();
    if (emailSaving || verificationSendLoading || verificationCheckLoading) return;
    const submittedEmail = initialEmail;
    if (emailDirty) {
      verificationSendError = m.settings_email_verify_save_email_first();
      return;
    }
    if (emailVerified) {
      verificationSendError = '';
      return;
    }

    verificationSendLoading = true;
    verificationSendError = '';
    verificationSent = false;
    verificationSuccess = false;

    try {
      await sendVerificationEmail();
      if (!current()) return;
      if (emailDirty || initialEmail !== submittedEmail) return;
      verificationSent = true;
      later(() => (verificationSent = false), 8000);
    } catch (err) {
      if (!current()) return;
      verificationSendError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) verificationSendLoading = false;
    }
  }

  async function submitEmailVerification(e: SubmitEvent) {
    e.preventDefault();
    const current = sessionScope.capture();
    if (emailSaving || verificationSendLoading || verificationCheckLoading) return;
    const submittedEmail = initialEmail;

    if (emailDirty) {
      verificationCheckError = m.settings_email_verify_save_email_first();
      return;
    }

    const code = verificationCode.trim();
    if (code === '') {
      verificationCheckError = m.settings_email_verify_code_required();
      return;
    }

    verificationCheckLoading = true;
    verificationCheckError = '';
    verificationSuccess = false;

    try {
      await verifyEmail(code);
      if (!current() || emailDirty || initialEmail !== submittedEmail) return;
      emailVerified = true;
      verificationCode = '';
      verificationSent = false;
      verificationSuccess = true;
      later(() => (verificationSuccess = false), 5000);
    } catch (err) {
      if (!current()) return;
      verificationCheckError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) verificationCheckLoading = false;
    }
  }

  async function saveCW(e: SubmitEvent) {
    const current = sessionScope.capture();
    e.preventDefault();
    if (!cwDirty || cwSaving) return;
    cwSaving = true;
    cwError = '';
    cwSaved = false;
    try {
      const normalized = saveClientCwSettings({
        char_wpm: charWpm,
        eff_wpm: effWpm,
        freq,
        start_delay: startDelay
      });

      charWpm = normalized.char_wpm;
      effWpm = normalized.eff_wpm;
      freq = normalized.freq;
      startDelay = normalized.start_delay;

      if ($user) {
        await saveCWSettings(normalized);
        if (!current()) return;
      }

      initialCharWpm = normalized.char_wpm;
      initialEffWpm = normalized.eff_wpm;
      initialFreq = normalized.freq;
      initialStartDelay = normalized.start_delay;
      if (
        charWpm !== normalized.char_wpm ||
        effWpm !== normalized.eff_wpm ||
        freq !== normalized.freq ||
        startDelay !== normalized.start_delay
      )
        return;
      showSavedFlag((value) => {
        cwSaved = value;
      });
    } catch (err) {
      if (!current()) return;
      cwError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) cwSaving = false;
    }
  }

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
      showSavedFlag((value) => {
        passwordSaved = value;
      });
    } catch (err) {
      if (!current()) return;
      passwordError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) passwordSaving = false;
    }
  }

  async function savePage(e: SubmitEvent) {
    const current = sessionScope.capture();
    e.preventDefault();
    if (!pageDirty || pageSaving) return;
    pageSaving = true;
    pageError = '';
    pageSaved = false;
    pageLesson = normalizeLesson(pageLesson, LESSONS.length);

    try {
      const pagePayload: PageSettings = {
        language: pageLanguage,
        cur_lesson: pageLesson
      };

      if ($user) {
        await savePageSettings(pagePayload);
        if (!current()) return;
      }

      applyClientPageSettings(pagePayload, LESSONS.length, setLangPreference, {
        applyLanguage: false
      });
      initialPageLesson = pagePayload.cur_lesson;
      if (pageLesson !== pagePayload.cur_lesson) return;
      showSavedFlag((value) => {
        pageSaved = value;
      });
    } catch (err) {
      if (!current()) return;
      pageError = localizeApiError(err, () => m.settings_save_error());
    } finally {
      if (current()) pageSaving = false;
    }
  }
</script>

<div class="page-narrow">
  <header class="settings-heading">
    <h1 class="page-title">{m.settings_title()}</h1>
  </header>

  {#if loading}
    <LoadingSpinner />
  {:else if loadError}
    <ErrorAlert message={loadError} />
    <button type="button" class="btn-ghost" onclick={() => void loadAll()}
      >{m.common_retry()}</button
    >
  {:else}
    {#if !$user}
      <div class="notice">
        <GuestNotice class="body-text" />
      </div>
    {/if}

    {#if $user}
      <!-- Account -->
      <section class="panel panel--ledger">
        <h2 class="card-title">{m.settings_account_section()}</h2>
        <form onsubmit={saveCallSign} class="settings-form">
          <label class="field">
            <span class="label-text">{m.settings_username_label()}</span>
            <input type="text" value={username} class="input" disabled />
            <span class="field-hint">{m.settings_username_locked_hint()}</span>
          </label>
          <label class="field">
            <span class="label-text">{m.settings_call_sign_label()}</span>
            <div class="settings-input-action">
              <input
                type="text"
                bind:value={callSign}
                class="input"
                placeholder={m.settings_call_sign_placeholder()}
                maxlength="32"
              />
              {#if callSignDirty || callSignSaving || callSignSaved}
                <SaveButton saving={callSignSaving} saved={callSignSaved} />
              {/if}
            </div>
          </label>
          {#if callSignError}
            <ErrorAlert message={callSignError} />
          {/if}
        </form>

        <form onsubmit={saveEmail} class="settings-form">
          <label class="field">
            <span class="label-text">{m.settings_email_label()}</span>
            <div class="settings-input-action">
              <input type="email" bind:value={email} class="input" required />
              {#if emailDirty || emailSaving || emailSaved}
                <SaveButton saving={emailSaving} saved={emailSaved} />
              {/if}
            </div>
          </label>
          {#if emailError}
            <ErrorAlert message={emailError} />
          {/if}
        </form>

        <div class="settings-email-verification">
          <p class={`settings-email-status ${emailVerified ? 'is-verified' : 'is-unverified'}`}>
            {emailVerified
              ? m.settings_email_verify_status_verified()
              : m.settings_email_verify_status_unverified()}
          </p>

          {#if !emailVerified}
            <div class="settings-input-action">
              <button
                type="button"
                class="btn-primary settings-btn-compact"
                onclick={requestEmailVerificationCode}
                disabled={verificationSendLoading || emailDirty}
              >
                {verificationSendLoading
                  ? m.settings_saving()
                  : verificationSent
                    ? m.settings_email_verify_code_sent()
                    : m.settings_email_verify_send_code()}
              </button>
            </div>

            <form
              onsubmit={submitEmailVerification}
              class="settings-form settings-verification-form"
            >
              <label class="field">
                <span class="label-text">{m.settings_email_verify_code_label()}</span>
                <div class="settings-input-action">
                  <input
                    type="text"
                    bind:value={verificationCode}
                    class="input"
                    placeholder={m.settings_email_verify_code_placeholder()}
                    inputmode="numeric"
                    autocomplete="one-time-code"
                  />
                  <button
                    type="submit"
                    class="btn-primary settings-btn-compact"
                    disabled={verificationCheckLoading || emailDirty}
                  >
                    {verificationCheckLoading
                      ? m.settings_saving()
                      : verificationSuccess
                        ? m.settings_email_verify_verified()
                        : m.settings_email_verify_confirm()}
                  </button>
                </div>
              </label>
            </form>
          {/if}

          {#if verificationSendError}
            <ErrorAlert message={verificationSendError} />
          {/if}
          {#if verificationCheckError}
            <ErrorAlert message={verificationCheckError} />
          {/if}
        </div>
      </section>

      <!-- Password gets its own surface: every panel is then headed by an
           `h2.card-title` (the password group used to be an `h3` buried half-way
           down the account panel), and the account panel stays about identity. -->
      <section class="panel panel--ledger">
        <h2 class="card-title">{m.settings_password_section()}</h2>
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
      </section>
    {/if}

    <!-- Preferences -->
    <section class="panel panel--ledger">
      <h2 class="card-title">{m.settings_page_section()}</h2>
      <form onsubmit={savePage} class="settings-form">
        <label class="field">
          <span class="label-text">{m.settings_language_label()}</span>
          <select
            class="select"
            value={pageLanguage}
            onchange={(e) => applyLanguageChange(e.currentTarget.value as LocalePreference)}
          >
            <option value="auto">{m.theme_auto()}</option>
            {#each locales as locale (locale)}
              <option value={locale}>{getLocaleLongLabel(locale)}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span class="label-text">{m.settings_current_lesson_label()}</span>
          <input type="number" bind:value={pageLesson} min="1" max={LESSONS.length} class="input" />
        </label>
        {#if pageError}
          <ErrorAlert message={pageError} />
        {/if}
        {#if pageDirty || pageSaving || pageSaved}
          <div class="settings-action-row">
            <SaveButton saving={pageSaving} saved={pageSaved} />
          </div>
        {/if}
      </form>
    </section>

    <!-- CW Settings -->
    <section class="panel panel--ledger">
      <h2 class="card-title">{m.settings_cw_section()}</h2>
      <form onsubmit={saveCW} class="settings-form">
        <label class="field">
          <span class="label-text">{m.trainer_label_char_wpm()}</span>
          <input type="number" bind:value={charWpm} min="5" max="50" class="input" />
        </label>
        <label class="field">
          <span class="label-text">{m.trainer_label_eff_wpm()}</span>
          <input type="number" bind:value={effWpm} min="5" max="50" class="input" />
        </label>
        <div class="field">
          <label class="label-text" for="settings-frequency">{m.trainer_label_freq()}</label>
          <div class="settings-tone-action">
            <input
              id="settings-frequency"
              type="number"
              bind:value={freq}
              min="300"
              max="2000"
              class="input"
            />
            <button
              type="button"
              class="btn-ghost"
              onclick={playTestTone}
              disabled={!canTestTone}
              title={m.settings_test_tone_label()}
              aria-label={m.settings_test_tone_label()}
            >
              <Volume2 size={16} aria-hidden="true" />
              <span>{m.settings_test_tone()}</span>
            </button>
          </div>
        </div>
        <label class="field">
          <span class="label-text">{m.trainer_label_start_delay()}</span>
          <input type="number" bind:value={startDelay} min="0" max="10" step="0.5" class="input" />
        </label>
        {#if cwError}
          <ErrorAlert message={cwError} />
        {/if}
        {#if cwDirty || cwSaving || cwSaved}
          <div class="settings-action-row">
            <SaveButton saving={cwSaving} saved={cwSaved} />
          </div>
        {/if}
      </form>
    </section>

    <!-- Data Management -->
    <section class="panel panel--ledger">
      <h2 class="card-title">{m.settings_data_title()}</h2>
      <div class="settings-form">
        <p class="field-hint">{m.settings_data_description()}</p>

        <div class="data-actions-row">
          <button
            type="button"
            class="btn-ghost text-danger"
            disabled={clearing}
            aria-expanded={confirmClearOpen}
            aria-controls="confirm-clear-data"
            onclick={() => {
              clearError = '';
              confirmClearOpen = true;
            }}
          >
            <Trash2 size={16} />
            <span>{m.settings_data_clear()}</span>
          </button>
          {#if clearSuccess}
            <span class="clear-success-label" role="status">{m.settings_data_cleared()}</span>
          {/if}
        </div>

        {#if confirmClearOpen}
          <div
            id="confirm-clear-data"
            class="confirm-clear-box"
            role="group"
            aria-labelledby="confirm-clear-title"
            aria-busy={clearing}
          >
            <p id="confirm-clear-title" class="confirm-clear-text">{m.settings_data_confirm()}</p>
            {#if clearBlocked}
              <p class="field-hint" role="status">{m.settings_data_waiting()}</p>
            {/if}
            {#if clearError}
              <ErrorAlert message={clearError} />
            {/if}
            <div class="confirm-actions">
              <button
                type="button"
                class="btn-primary"
                disabled={clearing}
                onclick={handleClearLocalData}
              >
                {clearing ? m.common_loading() : m.settings_data_delete()}
              </button>
              <button
                type="button"
                class="btn-ghost"
                disabled={clearing}
                onclick={() => (confirmClearOpen = false)}
              >
                {m.forum_cancel()}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .settings-heading {
    margin-bottom: var(--block-gap);
  }
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .settings-form + .settings-form {
    margin-top: var(--block-gap);
  }
  .settings-email-verification {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .settings-email-status {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .settings-email-status.is-verified {
    color: var(--status-good);
  }
  .settings-email-status.is-unverified {
    color: var(--status-ok);
  }
  .settings-verification-form {
    margin-top: 0;
  }
  .settings-input-action {
    display: flex;
    gap: 0.6rem;
    align-items: stretch;
  }
  .settings-input-action .input {
    flex: 1;
    min-width: 0;
  }
  .settings-tone-action {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-3);
    align-items: stretch;
  }
  .settings-tone-action .input {
    min-width: 0;
  }
  .settings-tone-action .btn-ghost {
    min-height: var(--answer-target-min);
    white-space: nowrap;
  }
  .settings-action-row {
    display: flex;
    justify-content: flex-end;
  }

  .data-actions-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-2);
  }

  .text-danger {
    color: var(--danger, var(--status-bad));
  }

  .clear-success-label {
    font-size: var(--text-xs);
    color: var(--status-good);
  }

  .confirm-clear-box {
    margin-top: var(--space-3);
    padding: var(--space-4);
    background-color: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .confirm-clear-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: var(--leading-normal);
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-3);
  }

  @media (max-width: 720px) {
    .settings-input-action {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>

<script lang="ts">
  import { learningSyncState, syncLearningNow } from '#lib/learning-sync.svelte.ts';
  import TrainingSyncStatus from '#lib/components/TrainingSyncStatus.svelte';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { getAuthSession, user } from '#lib/auth.ts';
  import { createSessionScope } from '#lib/session-scope.ts';
  import {
    getTrainingOwner,
    trainingSyncState,
    subscribeTrainingSync,
    syncTrainingNow,
    importUnclaimedTraining,
    getUnclaimedTrainingCount
  } from '#lib/training-sync.svelte.ts';
  import {
    saveCWSettings,
    getUserInfo,
    updateCallSign,
    updateEmail,
    sendVerificationEmail,
    verifyEmail,
    savePageSettings,
    type PageSettings
  } from '#lib/api.ts';
  import { langPreference, setLangPreference } from '#lib/i18n.svelte.ts';
  import { locales } from '#lib/paraglide/runtime.js';
  import { getLocaleLongLabel, type LocalePreference } from '#lib/locale.ts';
  import { LESSONS } from '#lib/training/sequence.ts';
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
  import type { AudioEngine } from '#lib/audio/engine.ts';
  import { createEvidenceAudioEngine } from '#lib/audio/evidence-engine.ts';
  import { buildAudioPlan } from '#lib/training/timing.ts';
  import LoadingSpinner from '#lib/components/LoadingSpinner.svelte';
  import ErrorAlert from '#lib/components/ErrorAlert.svelte';
  import GuestNotice from '#lib/components/GuestNotice.svelte';
  import SaveButton from '#lib/components/SaveButton.svelte';
  import SettingsPassword from '#lib/components/settings/SettingsPassword.svelte';
  import SettingsData from '#lib/components/settings/SettingsData.svelte';
  import { readStoredTheme, setTheme, type Theme } from '#lib/theme.ts';
  import { Volume2 } from '@lucide/svelte';
  import * as m from '#lib/paraglide/messages.js';

  let theme = $state<Theme>('auto');
  onMount(() => {
    theme = readStoredTheme();
  });

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
  let passwordEnabled = $state<boolean | null>(null);
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

  // Page settings section
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
  let unclaimedCount = $state(0);
  let unclaimedError = $state(false);
  let importing = $state(false);
  let importError = $state(false);
  let syncMounted = false;
  let countVersion = 0;
  let lastAuthLoaded: string | null = null;
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

  async function loadUnclaimedCount() {
    const owner = getTrainingOwner();
    const sessionCurrent = sessionScope.capture();
    const version = ++countVersion;
    const current = () =>
      syncMounted && sessionCurrent() && owner === getTrainingOwner() && version === countVersion;
    try {
      const count = await getUnclaimedTrainingCount();
      if (!current()) return;
      unclaimedCount = count;
      unclaimedError = false;
    } catch {
      if (current()) unclaimedError = true;
    }
  }

  onMount(() => {
    syncMounted = true;
    let identity = '';
    let revision = '';
    const unsubscribe = subscribeTrainingSync((state) => {
      const nextIdentity = `${state.owner}:${getAuthSession().generation}`;
      if (identity !== nextIdentity) {
        identity = nextIdentity;
        countVersion++;
        unclaimedCount = 0;
        unclaimedError = importError = importing = false;
      }
      const nextRevision = `${identity}:${state.version}`;
      if (revision === nextRevision) return;
      revision = nextRevision;
      void loadUnclaimedCount();
    });
    return () => {
      syncMounted = false;
      countVersion++;
      unsubscribe();
    };
  });

  async function importHistory() {
    const owner = getTrainingOwner();
    if (importing || owner === 'unclaimed') return;
    const sessionCurrent = sessionScope.capture();
    const current = () => syncMounted && sessionCurrent() && owner === getTrainingOwner();
    importing = true;
    importError = false;
    try {
      await importUnclaimedTraining();
      if (current()) await loadUnclaimedCount();
    } catch {
      if (current()) importError = true;
    } finally {
      if (current()) importing = false;
    }
  }

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
    toneAudio = createEvidenceAudioEngine({
      source: 'reference',
      onError: () => {
        cwError = m.lesson_feedback_audio_error();
      }
    });
    return () => {
      void toneAudio?.dispose();
      toneAudio = null;
    };
  });

  function playTestTone() {
    if (!toneAudio || !canTestTone) return;
    cwError = '';
    try {
      const plan = buildAudioPlan('AAA', {
        frequency: freq,
        charWpm,
        effWpm: Math.min(effWpm, charWpm)
      });
      toneAudio.play(plan);
    } catch (err) {
      console.error('Failed to play test tone:', err);
      cwError = m.lesson_feedback_audio_error();
    }
  }

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
    passwordEnabled = null;
    callSignSaving = emailSaving = pageSaving = cwSaving = false;
    callSignSaved = emailSaved = pageSaved = cwSaved = false;
    callSignError = emailError = pageError = cwError = '';
    verificationSendLoading = verificationCheckLoading = false;
    resetEmailVerificationState();
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
      passwordEnabled = info.password_enabled;
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

  // Language applies immediately through the shared synchronization helper.
  // Saving advanced preferences covers the stored lesson only.
  function applyLanguageChange(next: LocalePreference) {
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
        language: langPreference.value,
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

<div class="page-narrow settings-page">
  <header class="settings-heading"><h1 class="page-title">{m.settings_title()}</h1></header>
  <nav class="settings-sections" aria-label={m.settings_title()}>
    <a href="#preferences">{m.settings_appearance_title()}</a>
    {#if !loading && !loadError}
      <a href="#sound-defaults">{m.settings_sound_defaults()}</a>
    {/if}
    <a href="#sync-storage">{m.settings_sync_storage_title()}</a>
    {#if !loading && !loadError}
      <a href="#account">{m.settings_account_section()}</a>
    {/if}
  </nav>
  <section class="panel panel--ledger" id="preferences" aria-labelledby="preferences-title">
    <h2 class="card-title" id="preferences-title">{m.settings_appearance_title()}</h2>
    <div class="settings-form">
      <label class="field">
        <span class="label-text">{m.settings_theme_label()}</span>
        <select
          class="select"
          value={theme}
          onchange={(event) => {
            theme = setTheme(event.currentTarget.value as Theme);
          }}
        >
          <option value="auto">{m.theme_auto()}</option>
          <option value="light">{m.theme_light()}</option>
          <option value="dark">{m.theme_dark()}</option>
        </select>
      </label>
      <label class="field">
        <span class="label-text">{m.settings_language_label()}</span>
        <select
          class="select"
          value={langPreference.value}
          onchange={(e) => applyLanguageChange(e.currentTarget.value as LocalePreference)}
        >
          <option value="auto">{m.theme_auto()}</option>
          {#each locales as locale (locale)}
            <option value={locale}>{getLocaleLongLabel(locale)}</option>
          {/each}
        </select>
      </label>
    </div>
  </section>
  {#if !loading && !loadError}
    <!-- CW Settings -->
    <section class="panel panel--ledger" id="sound-defaults">
      <h2 class="card-title">{m.settings_sound_defaults()}</h2>
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
  {/if}
  {#key trainingSyncState.owner}
    <SettingsData
      owner={trainingSyncState.owner}
      pending={trainingSyncState.pending}
      syncing={trainingSyncState.syncing}
      synced={trainingSyncState.synced}
      error={trainingSyncState.error ??
        (importError || unclaimedError ? m.history_sync_error() : null)}
      onSync={() => void syncTrainingNow()}
      onImport={() => void importHistory()}
      {unclaimedCount}
      {importing}
    />
  {/key}
  <section class="panel panel--ledger" id="learning-evidence">
    <h2 class="card-title">{m.learning_overview_heading()}</h2>
    <p class="body-text">{m.learning_guest_boundary()}</p>
    <TrainingSyncStatus
      expanded
      owner={learningSyncState.owner}
      pending={learningSyncState.pending}
      syncing={learningSyncState.syncing}
      synced={learningSyncState.synced}
      error={learningSyncState.error}
      onSync={() => void syncLearningNow()}
    />
  </section>

  {#if loading}
    <LoadingSpinner />
  {:else if loadError}
    <ErrorAlert message={loadError} />
    <button type="button" class="btn-ghost" onclick={() => void loadAll()}
      >{m.common_retry()}</button
    >
  {:else}
    {#if !$user}<section class="panel panel--ledger" id="account">
        <h2 class="card-title">{m.settings_account_section()}</h2>
        <GuestNotice class="body-text" />
      </section>{/if}
    {#if $user}
      <!-- Account -->
      <section class="panel panel--ledger" id="account">
        <h2 class="card-title">{m.settings_account_section()}</h2>
        <form onsubmit={saveCallSign} class="settings-form">
          <label class="field">
            <span class="label-text">{m.settings_username_label()}</span>
            <input type="text" value={username} class="input" disabled />
            <span class="field-hint">{m.settings_username_locked_hint()}</span>
          </label>
          <div class="field">
            <label for="settings-call-sign" class="label-text">{m.settings_call_sign_label()}</label
            >
            <div class="settings-input-action">
              <input
                id="settings-call-sign"
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
          </div>
          {#if callSignError}
            <ErrorAlert message={callSignError} />
          {/if}
        </form>

        <form onsubmit={saveEmail} class="settings-form">
          <div class="field">
            <label for="settings-email" class="label-text">{m.settings_email_label()}</label>
            <div class="settings-input-action">
              <input id="settings-email" type="email" bind:value={email} class="input" required />
              {#if emailDirty || emailSaving || emailSaved}
                <SaveButton saving={emailSaving} saved={emailSaved} />
              {/if}
            </div>
          </div>
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
              <div class="field">
                <label for="settings-verification-code" class="label-text"
                  >{m.settings_email_verify_code_label()}</label
                >
                <div class="settings-input-action">
                  <input
                    id="settings-verification-code"
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
              </div>
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

      {#if passwordEnabled === true}
        <SettingsPassword />
      {:else if passwordEnabled === false}
        <section class="panel panel--ledger">
          <h2 class="card-title">{m.settings_password_section()}</h2>
          <p class="body-text">{m.google_password_notice()}</p>
        </section>
      {/if}
    {/if}

    <details class="settings-advanced">
      <summary>{m.settings_advanced()}</summary>
      <form onsubmit={savePage} class="settings-form">
        <p class="body-text">{m.settings_lesson_preference_hint()}</p>
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
    </details>
  {/if}
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--section-gap);
  }
  .settings-page :global(.panel--ledger) {
    margin: 0;
  }
  .settings-advanced summary {
    cursor: pointer;
    min-height: var(--answer-target-min);
    padding-block: var(--space-3);
  }
  .settings-page :global(section[id]) {
    scroll-margin-top: 5rem;
  }

  .settings-page > .settings-sections {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .settings-sections a {
    display: inline-flex;
    align-items: center;
    min-height: var(--answer-target-min);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--bg-inset);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }
  .settings-sections a:hover {
    color: var(--accent);
  }

  .settings-heading {
    margin-bottom: 0;
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

  @media (max-width: 720px) {
    .settings-input-action {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>

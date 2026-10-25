import {
  AuthStorageError,
  beginCredentialAttempt,
  googleSignIn,
  isAuthSessionCurrent,
  type CredentialAttempt
} from '#lib/auth.ts';
import { extractErrorCode } from '#lib/errorCode.ts';

export interface GoogleIdentityAPI {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential: string }) => void;
    auto_select: false;
    ux_mode: 'popup';
  }): void;
  renderButton(
    container: HTMLElement,
    options: {
      type: 'standard';
      size: 'large';
      text: 'continue_with';
      theme: 'outline';
      locale: string;
      click_listener: () => void;
    }
  ): void;
}

type GoogleWindow = Window & { google?: { accounts: { id: GoogleIdentityAPI } } };
let sdkPromise: Promise<GoogleIdentityAPI> | undefined;

/** Called only after mount; the hosted SDK is never part of the offline cache. */
export function loadGoogleIdentity(): Promise<GoogleIdentityAPI> {
  const ready = (window as GoogleWindow).google?.accounts.id;
  if (ready) return Promise.resolve(ready);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<GoogleIdentityAPI>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timeout = setTimeout(() => finish(), 10000);
    const finish = (api?: GoogleIdentityAPI) => {
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (api) resolve(api);
      else {
        script.remove();
        reject(new Error('GOOGLE_SIGN_IN_UNAVAILABLE'));
      }
    };
    script.onload = () => finish((window as GoogleWindow).google?.accounts.id);
    script.onerror = () => finish();
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
}

export interface GoogleFlowState {
  busy: boolean;
  needsUsername: boolean;
  error: unknown;
}

/** Holds Google credentials only for this mounted flow, with the auth module's epoch fence. */
export function createGoogleSignInFlow(update: (state: GoogleFlowState) => void) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  let alive = true;
  let attempt: CredentialAttempt | undefined;
  let credential = '';
  let busy = false;
  let needsUsername = false;
  let revision = 0;

  const emit = (error: unknown = null) => {
    if (alive) update({ busy, needsUsername, error });
  };
  function reset() {
    attempt?.cancel();
    attempt = undefined;
    credential = '';
    busy = false;
    needsUsername = false;
    revision += 1;
  }

  function canContinue() {
    try {
      attempt?.assertCurrent();
      return attempt !== undefined;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        reset();
        emit(new AuthStorageError(error));
      }
      return false;
    }
  }

  async function exchange(username?: string) {
    if (!alive || busy || !attempt || !canContinue() || !credential) return;
    const activeAttempt = attempt;
    const request = ++revision;
    busy = true;
    emit();
    try {
      await googleSignIn(credential, nonce, activeAttempt, username);
      credential = '';
      needsUsername = false;
      busy = false;
      emit();
    } catch (error) {
      if (!alive || request !== revision) return;
      let failure = error;
      let current = false;
      try {
        current = activeAttempt.isCurrent();
      } catch (storageError) {
        failure = new AuthStorageError(storageError);
      }
      const storageFailed =
        failure instanceof AuthStorageError &&
        (!failure.session || isAuthSessionCurrent(failure.session));
      if (!current && !storageFailed) return;
      const code = extractErrorCode(failure);
      needsUsername =
        code === 'GOOGLE_SIGNUP_REQUIRED' ||
        (username !== undefined &&
          ['USERNAME_ALREADY_IN_USE', 'INVALID_REQUEST_BODY'].includes(code ?? ''));
      if (!needsUsername) credential = '';
      busy = false;
      emit(code === 'GOOGLE_SIGNUP_REQUIRED' ? null : failure);
    } finally {
      if (alive && request === revision) {
        busy = false;
        // Preserve the error emitted by catch; only successful completion emits here.
      }
    }
  }

  return {
    nonce,
    begin() {
      if (!alive) return;
      reset();
      try {
        attempt = beginCredentialAttempt();
        emit();
      } catch (error) {
        emit(new AuthStorageError(error));
      }
    },
    receive(value: string) {
      if (!alive || busy || !canContinue()) return Promise.resolve();
      credential = value;
      return exchange();
    },
    register(username: string) {
      return exchange(username);
    },
    cancel() {
      reset();
      emit();
    },
    dispose() {
      alive = false;
      reset();
    }
  };
}

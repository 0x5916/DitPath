import { PUBLIC_API_BASE } from '$app/env/public';
import { writable } from 'svelte/store';
import { extractErrorCodeFromBody } from '#lib/errorCode.ts';
import { AUTH_STORAGE_KEYS } from '#lib/storageKeys.ts';

export interface AuthUser {
  username: string;
}

export const user = writable<AuthUser | null>(null);

const API_BASE = PUBLIC_API_BASE;
export interface AuthSession {
  readonly generation: number;
  readonly username: string | null;
}

export class SessionChangedError extends Error {
  constructor() {
    super('AUTH_SESSION_CHANGED');
    this.name = 'AbortError';
  }
}

export class AuthStorageError extends Error {
  readonly code = 'BROWSER_STORAGE_FAILED';

  constructor(
    cause: unknown,
    readonly session?: AuthSession
  ) {
    super('AUTH_STORAGE_FAILED', { cause });
    this.name = 'AuthStorageError';
  }
}

let storageBlocked = false;
let generation = 0;
let credentialAttempt = 0;
let storedIdentity = '';
let sessionController = new AbortController();
let refreshInFlight: { generation: number; promise: Promise<boolean> } | null = null;

function readAuth(key: string): string | null {
  return !storageBlocked && typeof window !== 'undefined' && typeof localStorage !== 'undefined'
    ? localStorage.getItem(key)
    : null;
}

function rememberIdentity(): void {
  storedIdentity = JSON.stringify(Object.values(AUTH_STORAGE_KEYS).map(readAuth));
}

function advanceSession(): void {
  generation += 1;
  sessionController.abort();
  sessionController = new AbortController();
  rememberIdentity();
}

/** Snapshot for fencing asynchronous account work. Token refresh keeps this identity. */
export function getAuthSession(): AuthSession {
  const identity = JSON.stringify(Object.values(AUTH_STORAGE_KEYS).map(readAuth));
  if (identity !== storedIdentity) advanceSession();
  return { generation, username: readAuth(AUTH_STORAGE_KEYS.username) };
}

export function isAuthSessionCurrent(session: AuthSession): boolean {
  return getAuthSession().generation === session.generation;
}

export function assertAuthSessionCurrent(session: AuthSession): void {
  if (!isAuthSessionCurrent(session)) throw new SessionChangedError();
}

/** Rehydrate user from stored tokens on app start */
export function initAuth() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  if (storageBlocked) {
    try {
      // After failed cleanup, recover only from empty storage or a successful local login.
      // A partial cross-tab write must not reactivate a mixed credential set.
      if (Object.values(AUTH_STORAGE_KEYS).some((key) => localStorage.getItem(key) !== null))
        return;
      storageBlocked = false;
    } catch {
      return;
    }
  }
  getAuthSession();
  const token = readAuth(AUTH_STORAGE_KEYS.accessToken);
  const username = readAuth(AUTH_STORAGE_KEYS.username);
  user.set(token && username ? { username } : null);
}

export async function register(username: string, email: string, password: string): Promise<void> {
  await postCredentials(
    '/auth/register',
    { username, email, password },
    'REGISTER_FAILED',
    username
  );
}

export async function login(username: string, password: string): Promise<void> {
  await postCredentials(
    '/auth/login',
    { identifier: username, password },
    'LOGIN_FAILED',
    username
  );
}

/**
 * POST credentials, resolve the display username and persist the session.
 * `fallbackCode` is the API error code used when the response carries none.
 */
async function postCredentials(
  path: string,
  payload: Record<string, string>,
  fallbackCode: string,
  fallbackUsername: string
): Promise<void> {
  const attempt = ++credentialAttempt;
  const session = getAuthSession();
  const signal = sessionController.signal;
  const assertCurrentAttempt = () => {
    assertAuthSessionCurrent(session);
    if (attempt !== credentialAttempt) throw new SessionChangedError();
  };
  const response = await fetch(`${API_BASE}${path}`, {
    signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  assertCurrentAttempt();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    assertCurrentAttempt();
    throw new Error(extractErrorCodeFromBody(body) ?? fallbackCode);
  }

  const data = await response.json();
  assertCurrentAttempt();
  const resolvedUsername = await resolveUsername(data.access_token, fallbackUsername, signal);
  assertCurrentAttempt();
  persistTokens(data.access_token, data.refresh_token, resolvedUsername);
  advanceSession();
  user.set({ username: resolvedUsername });
}

async function refreshTokens(session: AuthSession): Promise<boolean> {
  assertAuthSessionCurrent(session);
  if (refreshInFlight?.generation === session.generation) return refreshInFlight.promise;

  const request = { generation: session.generation, promise: runTokenRefresh(session) };
  refreshInFlight = request;
  try {
    return await request.promise;
  } finally {
    if (refreshInFlight === request) refreshInFlight = null;
  }
}

async function runTokenRefresh(session: AuthSession): Promise<boolean> {
  const refreshToken = readAuth(AUTH_STORAGE_KEYS.refreshToken);
  if (!refreshToken) {
    await logout();
    return false;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      signal: sessionController.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
  } catch {
    assertAuthSessionCurrent(session);
    // Network/transport failure: do not force logout.
    return false;
  }

  assertAuthSessionCurrent(session);
  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await logout();
    }
    return false;
  }

  const data = await response.json();
  assertAuthSessionCurrent(session);
  persistTokens(data.access_token, data.refresh_token, session.username ?? '');
  return true;
}

/** Decode a JWT's payload claim set, or null when the token is malformed. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(atob(token.split('.')[1]));
    return typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Return true if the token is expired, or cannot be read at all. */
function isTokenExpired(token: string, bufferSeconds: number = 60): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp !== 'number' || Date.now() / 1000 + bufferSeconds >= exp;
}

/**
 * Fetch wrapper that proactively refreshes an expired access token before
 * sending, and retries once on a 401 as a safety net.
 */
export async function apiFetch(
  input: string,
  init: RequestInit = {},
  options: { retryUnauthorized?: boolean } = {}
): Promise<Response> {
  const session = getAuthSession();
  let token = readAuth(AUTH_STORAGE_KEYS.accessToken);
  const headers = new Headers(init.headers);
  const controller = new AbortController();
  const sessionSignal = sessionController.signal;
  const abort = () => controller.abort();
  sessionSignal.addEventListener('abort', abort, { once: true });
  init.signal?.addEventListener('abort', abort, { once: true });
  if (sessionSignal.aborted || init.signal?.aborted) abort();

  try {
    if (token && isTokenExpired(token)) {
      const refreshed = await refreshTokens(session);
      assertAuthSessionCurrent(session);
      token = refreshed ? readAuth(AUTH_STORAGE_KEYS.accessToken) : null;
    }

    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response = await fetch(`${API_BASE}${input}`, {
      ...init,
      headers,
      signal: controller.signal
    });
    assertAuthSessionCurrent(session);

    if (response.status === 401 && options.retryUnauthorized !== false) {
      const refreshed = await refreshTokens(session);
      assertAuthSessionCurrent(session);
      if (refreshed) {
        const renewedToken = readAuth(AUTH_STORAGE_KEYS.accessToken);
        if (renewedToken) headers.set('Authorization', `Bearer ${renewedToken}`);
        else headers.delete('Authorization');
        response = await fetch(`${API_BASE}${input}`, {
          ...init,
          headers,
          signal: controller.signal
        });
        assertAuthSessionCurrent(session);
      }
    }
    return response;
  } catch (error) {
    assertAuthSessionCurrent(session);
    throw error;
  } finally {
    sessionSignal.removeEventListener('abort', abort);
    init.signal?.removeEventListener('abort', abort);
  }
}

/** Clear only the captured session, without a network logout after server revocation. */
export function clearAuthSession(session: AuthSession): void {
  assertAuthSessionCurrent(session);
  clearLocalSession();
}

function clearLocalSession(): void {
  credentialAttempt += 1;
  // Stop using credentials and cancel pending work before touching fallible storage.
  storageBlocked = true;
  advanceSession();
  user.set(null);
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  for (const key of Object.values(AUTH_STORAGE_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Try every key even if one removal fails. */
    }
  }
  try {
    const values = Object.values(AUTH_STORAGE_KEYS).map((key) => localStorage.getItem(key));
    if (values.every((value) => value === null)) storageBlocked = false;
  } catch {
    // Keep storage blocked if the browser cannot confirm cleanup.
  }
  rememberIdentity();
}

export async function logout(): Promise<void> {
  const session = getAuthSession();
  const refreshToken = readAuth(AUTH_STORAGE_KEYS.refreshToken);
  // Invalidate immediately; a delayed logout response must never clear a later login.
  clearAuthSession(session);

  if (refreshToken) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
    } catch {
      // Ignore network/logout API failures; the local session is already cleared.
    }
  }
}

function persistTokens(accessToken: string, refreshToken: string, username: string) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const keys = Object.values(AUTH_STORAGE_KEYS);
  const previous = keys.map((key) => localStorage.getItem(key));
  const next = [accessToken, refreshToken, username];
  try {
    keys.forEach((key, index) => localStorage.setItem(key, next[index]));
  } catch (error) {
    keys.forEach((key, index) => {
      try {
        const value = previous[index];
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        /* Verify the complete rollback below rather than leaving a partial identity active. */
      }
    });
    let restored = false;
    try {
      restored = keys.every((key, index) => localStorage.getItem(key) === previous[index]);
    } catch {
      /* Fall through to safe cleanup. */
    }
    if (!restored) {
      clearLocalSession();
      throw new AuthStorageError(error, getAuthSession());
    }
    rememberIdentity();
    throw new AuthStorageError(error);
  }
  storageBlocked = false;
  rememberIdentity();
}

async function resolveUsername(
  accessToken: string,
  fallback: string,
  signal: AbortSignal
): Promise<string> {
  const payload = decodeJwtPayload(accessToken);
  if (typeof payload?.username === 'string' && payload.username.trim() !== '') {
    return payload.username;
  }

  try {
    const meRes = await fetch(`${API_BASE}/user/me`, {
      signal,
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!meRes.ok) return fallback;
    const me = await meRes.json();
    if (typeof me?.username === 'string' && me.username.trim() !== '') {
      return me.username;
    }
  } catch {
    // Ignore lookup failure and fallback.
  }

  return fallback;
}

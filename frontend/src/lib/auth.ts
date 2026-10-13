import { PUBLIC_API_BASE } from '$env/static/public';
import { writable } from 'svelte/store';
import { extractErrorCodeFromBody } from '$lib/errorCode';
import { AUTH_STORAGE_KEYS } from '$lib/storageKeys';

export interface AuthUser {
  username: string;
}

export const user = writable<AuthUser | null>(null);

const API_BASE = PUBLIC_API_BASE;
let refreshInFlight: Promise<boolean> | null = null;

/** Rehydrate user from stored tokens on app start */
export function initAuth() {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const username = localStorage.getItem(AUTH_STORAGE_KEYS.username);
  if (token && username) {
    user.set({ username });
  }
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
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(extractErrorCodeFromBody(body) ?? fallbackCode);
  }

  const data = await response.json();
  const resolvedUsername = await resolveUsername(data.access_token, fallbackUsername);
  persistTokens(data.access_token, data.refresh_token, resolvedUsername);
  user.set({ username: resolvedUsername });
}

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = runTokenRefresh();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function runTokenRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken);
  if (!refreshToken) {
    // No refresh token means the session can't be renewed.
    await logout();
    return false;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
  } catch {
    // Network/transport failure: do not force logout.
    return false;
  }

  if (!response.ok) {
    // Only invalidate local auth state when refresh token is rejected.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      await logout();
    }
    return false;
  }

  const data = await response.json();
  const username = localStorage.getItem(AUTH_STORAGE_KEYS.username) ?? '';
  persistTokens(data.access_token, data.refresh_token, username);
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
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const headers = new Headers(init.headers);

  // Proactively refresh if the token is already expired
  if (token && isTokenExpired(token)) {
    const refreshed = await refreshTokens();
    token = refreshed ? localStorage.getItem(AUTH_STORAGE_KEYS.accessToken) : null;
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response = await fetch(`${API_BASE}${input}`, { ...init, headers });

  // Safety net: server says 401 even though we thought the token was valid
  if (response.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      const renewedToken = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
      if (renewedToken) {
        headers.set('Authorization', `Bearer ${renewedToken}`);
      } else {
        headers.delete('Authorization');
      }
      response = await fetch(`${API_BASE}${input}`, { ...init, headers });
    }
  }

  return response;
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken);

  if (refreshToken) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
    } catch {
      // Ignore network/logout API failures and clear local session anyway.
    }
  }

  localStorage.removeItem(AUTH_STORAGE_KEYS.accessToken);
  localStorage.removeItem(AUTH_STORAGE_KEYS.refreshToken);
  localStorage.removeItem(AUTH_STORAGE_KEYS.username);
  user.set(null);
}

function persistTokens(accessToken: string, refreshToken: string, username: string) {
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, accessToken);
  localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, refreshToken);
  localStorage.setItem(AUTH_STORAGE_KEYS.username, username);
}

async function resolveUsername(accessToken: string, fallback: string): Promise<string> {
  const payload = decodeJwtPayload(accessToken);
  if (typeof payload?.username === 'string' && payload.username.trim() !== '') {
    return payload.username;
  }

  try {
    const meRes = await fetch(`${API_BASE}/user/me`, {
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

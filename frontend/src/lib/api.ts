import { apiFetch } from './auth';
import { extractErrorCodeFromBody } from './errorCode';

export class ApiError extends Error {
  status: number;

  body: unknown;

  code: string;

  constructor(code: string, status: number, body: unknown) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json'
} as const;
const inFlightGetRequests = new Map<string, Promise<unknown>>();

async function parseJsonBody<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength === '0') {
    return undefined as T;
  }

  const text = await res.text();
  if (text.trim() === '') {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = await parseJsonBody<unknown>(res).catch(() => null);
  throw new ApiError(extractErrorCodeFromBody(body) ?? fallback, res.status, body);
}

async function apiGetJson<T>(path: string, fallback: string): Promise<T> {
  const requestKey = `GET:${path}`;
  const existing = inFlightGetRequests.get(requestKey) as Promise<T> | undefined;
  if (existing) return existing;

  const request = (async () => {
    const res = await apiFetch(path);
    if (!res.ok) return throwApiError(res, fallback);

    try {
      return await parseJsonBody<T>(res);
    } catch {
      throw new ApiError(fallback, res.status, null);
    }
  })();

  inFlightGetRequests.set(requestKey, request);

  try {
    return await request;
  } finally {
    inFlightGetRequests.delete(requestKey);
  }
}

async function apiSendJson<T = void>(
  path: string,
  method: 'POST' | 'PUT',
  body: unknown,
  fallback: string
): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });

  if (!res.ok) return throwApiError(res, fallback);

  try {
    return await parseJsonBody<T>(res);
  } catch {
    throw new ApiError(fallback, res.status, null);
  }
}

/** Request helper for verbs whose response carries no body. */
async function apiNoBody(path: string, method: 'POST' | 'DELETE', fallback: string): Promise<void> {
  const res = await apiFetch(path, {
    method,
    headers: { Accept: 'application/json' }
  });

  if (!res.ok) return throwApiError(res, fallback);
}

export interface CWSettings {
  char_wpm: number;
  eff_wpm: number;
  freq: number;
  start_delay: number;
  updated_at?: string;
}

export interface PageSettings {
  language: string;
  cur_lesson: number;
  updated_at?: string;
}

export interface UserInfo {
  call_sign: string | null;
  username: string;
  email: string;
  email_verified: boolean;
  created_at: string;
}

export const FORUM_CATEGORIES = ['general', 'help', 'showcase', 'feedback'] as const;

export type ForumCategoryValue = (typeof FORUM_CATEGORIES)[number];

export function isForumCategory(value: string | null | undefined): value is ForumCategoryValue {
  return typeof value === 'string' && (FORUM_CATEGORIES as readonly string[]).includes(value);
}

export interface ForumAuthor {
  username: string;
  call_sign: string | null;
}

export interface ForumThreadSummary {
  id: string;
  category: ForumCategoryValue;
  title: string;
  author: ForumAuthor;
  reply_count: number;
  created_at: string;
}

export interface ForumThreadDetail extends ForumThreadSummary {
  body: string;
  updated_at: string;
}

export interface ForumReply {
  id: string;
  parent_id: string | null;
  body: string | null;
  author: ForumAuthor | null;
  is_deleted: boolean;
  created_at: string;
  children: ForumReply[];
}

export interface ForumThreadListPage {
  data: ForumThreadSummary[];
  total: number;
  limit: number;
  next_cursor: string | null;
}

export interface ForumReplyList {
  data: ForumReply[];
  total: number;
}

export interface ForumThreadQuery {
  category?: ForumCategoryValue | null;
  cursor?: string | null;
  limit?: number;
}

export async function getForumThreads(query: ForumThreadQuery = {}): Promise<ForumThreadListPage> {
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)));
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (query.category) params.set('category', query.category);
  if (query.cursor) params.set('cursor', query.cursor);

  const response = await apiGetJson<ForumThreadListPage>(
    `/forum/threads?${params.toString()}`,
    'FORUM_QUERY_FAILED'
  );

  return {
    data: response.data ?? [],
    total: response.total ?? 0,
    limit: response.limit ?? limit,
    next_cursor: response.next_cursor ?? null
  };
}

export async function getForumThread(threadId: string): Promise<ForumThreadDetail> {
  const response = await apiGetJson<{ data: ForumThreadDetail } | ForumThreadDetail>(
    `/forum/threads/${encodeURIComponent(threadId)}`,
    'FORUM_QUERY_FAILED'
  );
  return 'data' in response && response.data ? response.data : (response as ForumThreadDetail);
}

export async function getForumThreadReplies(threadId: string): Promise<ForumReplyList> {
  const response = await apiGetJson<ForumReplyList>(
    `/forum/threads/${encodeURIComponent(threadId)}/replies`,
    'FORUM_QUERY_FAILED'
  );
  return { data: response.data ?? [], total: response.total ?? 0 };
}

export async function createForumThread(
  category: ForumCategoryValue,
  title: string,
  body: string
): Promise<ForumThreadDetail> {
  const response = await apiSendJson<{ data: ForumThreadDetail }>(
    '/forum/threads',
    'POST',
    { category, title, body },
    'FORUM_CREATE_FAILED'
  );
  return response.data;
}

export async function createForumReply(
  threadId: string,
  body: string,
  parentId?: string
): Promise<ForumReply> {
  const response = await apiSendJson<{ data: ForumReply }>(
    `/forum/threads/${encodeURIComponent(threadId)}/replies`,
    'POST',
    { body, ...(parentId ? { parent_id: parentId } : {}) },
    'FORUM_CREATE_FAILED'
  );
  return response.data;
}

export async function deleteForumThread(threadId: string): Promise<void> {
  await apiNoBody(
    `/forum/threads/${encodeURIComponent(threadId)}`,
    'DELETE',
    'FORUM_DELETE_FAILED'
  );
}

export async function deleteForumReply(replyId: string): Promise<void> {
  await apiNoBody(`/forum/replies/${encodeURIComponent(replyId)}`, 'DELETE', 'FORUM_DELETE_FAILED');
}

export interface CombinedSettings {
  cw_settings: CWSettings;
  page_settings: PageSettings;
}

export async function getCWSettings(): Promise<CWSettings> {
  return apiGetJson<CWSettings>('/settings/cw', 'SETTINGS_FETCH_FAILED');
}

export async function saveCWSettings(settings: CWSettings): Promise<void> {
  await apiSendJson('/settings/cw', 'POST', settings, 'SETTINGS_UPDATE_FAILED');
}

export async function getSettings(): Promise<CombinedSettings> {
  return apiGetJson<CombinedSettings>('/settings/all', 'SETTINGS_FETCH_FAILED');
}

export async function getUserInfo(): Promise<UserInfo> {
  return apiGetJson<UserInfo>('/user/me', 'INTERNAL_SERVER_ERROR');
}

export async function savePageSettings(settings: PageSettings): Promise<void> {
  await apiSendJson('/settings/page', 'POST', settings, 'SETTINGS_UPDATE_FAILED');
}

export async function updateEmail(email: string): Promise<void> {
  await apiSendJson('/user/email', 'PUT', { email }, 'INTERNAL_SERVER_ERROR');
}

export async function sendVerificationEmail(): Promise<void> {
  await apiNoBody('/auth/send-verification-email', 'POST', 'VERIFICATION_SEND_FAILED');
}

export async function verifyEmail(code: string): Promise<void> {
  await apiSendJson('/auth/verify-email', 'POST', { code }, 'VERIFICATION_CODE_INVALID');
}

export async function updateCallSign(callSign: string): Promise<void> {
  await apiSendJson('/user/callsign', 'PUT', { call_sign: callSign }, 'INTERNAL_SERVER_ERROR');
}

export interface ProgressRecord {
  lesson: string;
  char_wpm: number;
  eff_wpm: number;
  accuracy: number;
  created_at: string;
  client_created_at?: string;
}

export async function getProgress(): Promise<ProgressRecord[]> {
  const data = await apiGetJson<{
    data?: Array<Omit<ProgressRecord, 'lesson'> & { lesson: string | number }>;
  }>('/cw/progress', 'PROGRESS_QUERY_FAILED');

  return (data.data ?? []).map((record) => ({
    ...record,
    lesson: String(record.lesson)
  }));
}

export async function submitProgress(
  lesson: number,
  charWpm: number,
  effWpm: number,
  accuracy: number,
  clientCreatedAt?: string
): Promise<void> {
  const payload: {
    lesson: number;
    char_wpm: number;
    eff_wpm: number;
    accuracy: number;
    client_created_at?: string;
  } = {
    lesson,
    char_wpm: charWpm,
    eff_wpm: effWpm,
    accuracy
  };

  if (clientCreatedAt) {
    payload.client_created_at = clientCreatedAt;
  }

  await apiSendJson('/cw/progress', 'PUT', payload, 'PROGRESS_CREATE_FAILED');
}

export async function updatePassword(oldPassword: string, newPassword: string): Promise<void> {
  await apiSendJson(
    '/user/password',
    'PUT',
    { old_password: oldPassword, new_password: newPassword },
    'INTERNAL_SERVER_ERROR'
  );
}

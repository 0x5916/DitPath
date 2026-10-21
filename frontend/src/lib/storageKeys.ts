export const AUTH_STORAGE_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  username: 'username'
} as const;

export const CW_STORAGE_KEYS = {
  lesson: 'learn.lesson',
  cwSettings: 'cw.settings.v1',
  cwSettingsUpdatedAt: 'cw.settings.updated_at.v1',
  pageSettingsUpdatedAt: 'cw.page_settings.updated_at.v1',
  progressQueue: 'cw.progress.queue.v1'
} as const;

export const UI_STORAGE_KEYS = {
  theme: 'theme'
} as const;

import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/paraglide/messages.js', () => ({
  auth_storage_error: () => 'Localized browser storage failure.',
  api_error_auth_rate_limited: () => 'Localized authentication rate limit.',
  api_error_auth_capacity_exceeded: () => 'Localized authentication capacity refusal.',
  api_error_request_body_too_large: () => 'Localized request size refusal.',
  api_error_verification_attempts_exceeded: () => 'Localized verification attempts refusal.',
  api_error_invalid_credentials: () => 'Localized invalid credentials.'
}));

import { localizeApiError } from '#lib/errorLocalization.ts';

describe('localizeApiError', () => {
  const authErrors = [
    ['BROWSER_STORAGE_FAILED', 'Localized browser storage failure.'],
    ['AUTH_RATE_LIMITED', 'Localized authentication rate limit.'],
    ['AUTH_CAPACITY_EXCEEDED', 'Localized authentication capacity refusal.'],
    ['REQUEST_BODY_TOO_LARGE', 'Localized request size refusal.'],
    ['VERIFICATION_ATTEMPTS_EXCEEDED', 'Localized verification attempts refusal.']
  ] as const;

  const errorForms = [
    ['direct code', (code: string) => ({ code })],
    ['response body', (code: string) => ({ body: { code, error: 'Backend English message.' } })],
    ['Error message', (code: string) => new Error(code)]
  ] as const;

  for (const [code, localizedMessage] of authErrors) {
    it.each(errorForms)(`localizes ${code} from a %s`, (_label, errorForCode) => {
      const fallback = vi.fn(() => 'Fallback message.');

      expect(localizeApiError(errorForCode(code), fallback)).toBe(localizedMessage);
      expect(fallback).not.toHaveBeenCalled();
    });
  }

  it('keeps the direct code ahead of the response body code', () => {
    expect(
      localizeApiError(
        { code: 'AUTH_RATE_LIMITED', body: { code: 'AUTH_CAPACITY_EXCEEDED' } },
        () => 'Fallback message.'
      )
    ).toBe('Localized authentication rate limit.');
  });

  it('preserves existing credential error localization', () => {
    expect(localizeApiError({ code: 'INVALID_CREDENTIALS' }, () => 'Fallback message.')).toBe(
      'Localized invalid credentials.'
    );
  });

  it.each([null, 'AUTH_RATE_LIMITED', {}, { code: 'UNKNOWN_ERROR' }, new Error('Network failed.')])(
    'uses the existing fallback for an unrecognized error: %j',
    (error) => {
      const fallback = vi.fn(() => 'Fallback message.');

      expect(localizeApiError(error, fallback)).toBe('Fallback message.');
      expect(fallback).toHaveBeenCalledTimes(1);
    }
  );
});

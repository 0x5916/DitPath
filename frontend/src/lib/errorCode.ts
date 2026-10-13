const ERROR_CODE_PATTERN = /^[A-Z0-9_]+$/;

function isApiErrorCode(value: string): boolean {
  return ERROR_CODE_PATTERN.test(value);
}

export function extractErrorCodeFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const code = (body as Record<string, unknown>).code;
  if (typeof code === 'string' && code.trim() !== '') return code;

  const error = (body as Record<string, unknown>).error;
  if (typeof error === 'string' && isApiErrorCode(error.trim())) {
    return error;
  }

  const message = (body as Record<string, unknown>).message;
  if (typeof message === 'string' && isApiErrorCode(message.trim())) {
    return message;
  }

  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail === 'string' && isApiErrorCode(detail.trim())) {
    return detail;
  }

  return null;
}

export function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const directCode = (error as { code?: unknown }).code;
  if (typeof directCode === 'string' && directCode.trim() !== '') {
    return directCode;
  }

  const bodyCode = extractErrorCodeFromBody((error as { body?: unknown }).body);
  if (bodyCode) return bodyCode;

  if (error instanceof Error && isApiErrorCode(error.message.trim())) {
    return error.message;
  }

  return null;
}

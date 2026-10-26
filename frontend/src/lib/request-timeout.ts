export const REQUEST_TIMEOUT_MS = 15_000;

export class RequestTimeoutError extends Error {
  readonly code = 'REQUEST_TIMEOUT';
  constructor() {
    super('REQUEST_TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/** Our API is non-streaming JSON: bound headers AND body before handing it to consumers. */
export async function fetchApiResponse(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : [])]);
  signal.throwIfAborted();
  const timer = setTimeout(() => controller.abort(new RequestTimeoutError()), REQUEST_TIMEOUT_MS);
  let abort!: () => void;
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, { ...init, signal });
        const body = await response.text();
        // Buffer once, without a cloned stream retaining a second copy. Preserve HTTP
        // status and headers so error handling and Retry-After retain their meaning.
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      })(),
      canceled
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

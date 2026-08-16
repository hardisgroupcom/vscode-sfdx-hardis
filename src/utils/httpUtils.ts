// Tiny local replacement for the axios usages that were spread across the codebase.
// Wraps the native fetch API (available in Node 18+, the VS Code extension host runtime)
// and reproduces the axios behaviors the call sites relied on:
// - throw on non-2xx responses (fetch resolves normally on 4xx/5xx)
// - a `timeoutMs` option backed by AbortSignal.timeout
// - the thrown error carries the HTTP `status` so callers can inspect it if needed

export interface HttpRequestOptions {
  /** Aborts the request after the given number of milliseconds */
  timeoutMs?: number;
  /** Extra headers to send with the request */
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

async function request(
  url: string,
  options: HttpRequestOptions = {},
): Promise<Response> {
  const signal = options.timeoutMs
    ? AbortSignal.timeout(options.timeoutMs)
    : undefined;
  const response = await fetch(url, {
    headers: options.headers,
    signal,
  });
  if (!response.ok) {
    throw new HttpError(
      `Request to ${url} failed with status ${response.status}`,
      response.status,
    );
  }
  return response;
}

/**
 * Fetches a URL and parses the response body as JSON.
 * Throws an HttpError (with a `status` property) on non-2xx responses.
 */
export async function getJson<T = any>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const response = await request(url, options);
  return (await response.json()) as T;
}

/**
 * Fetches a URL and returns the response body as text.
 * Throws an HttpError (with a `status` property) on non-2xx responses.
 */
export async function getText(
  url: string,
  options: HttpRequestOptions = {},
): Promise<string> {
  const response = await request(url, options);
  return await response.text();
}

/**
 * Fetches a URL, only checking that the response is reachable and returns a 2xx status.
 * Throws an HttpError (with a `status` property) on non-2xx responses.
 */
export async function ping(
  url: string,
  options: HttpRequestOptions = {},
): Promise<void> {
  await request(url, options);
}

/**
 * fetchWithRetry: HTTP helper with timeout and exponential backoff (retries 429/5xx and thrown
 * errors).
 *
 * Exports: FetchWithRetryOptions, fetchWithRetry
 * Feature: providers
 */
export interface FetchWithRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  signal?: AbortSignal;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.initialDelayMs ?? 100;
  const factor = options.backoffFactor ?? 2;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      const response = await fetchFn(url, {
        ...init,
        signal: options.signal,
      });

      // Status 429 (Rate Limited) or 5xx (Server Error) triggers retry
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, delay));
        delay *= factor;
        continue;
      }

      return response;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (options.signal?.aborted) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, delay));
        delay *= factor;
        continue;
      }
    }
  }

  throw lastError || new Error(`Network request failed after ${maxRetries} retries`);
}

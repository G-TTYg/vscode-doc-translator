export interface RetryOptions {
  readonly retries?: number;
  readonly retryDelayMs?: number;
}

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  options: RetryOptions = {}
): Promise<Response> {
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetchImpl(input, init);
    if (!isRetryable(response.status) || attempt === retries) {
      return response;
    }

    lastResponse = response;
    await delay(retryDelayMs * Math.max(1, attempt + 1));
  }

  return lastResponse as Response;
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

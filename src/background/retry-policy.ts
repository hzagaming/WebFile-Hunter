export interface RetryInput {
  attempt: number;
  status?: number;
  retryAfter?: string;
  networkError?: boolean;
  now: number;
  maxRetries?: number;
  random?: () => number;
}

export type RetryDecision =
  { retry: false; reason: string } | { retry: true; delayMs: number; reason: string };

export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export function getRetryDecision(input: RetryInput): RetryDecision {
  const maxRetries = input.maxRetries ?? 2;
  if (input.attempt >= maxRetries) return { retry: false, reason: "retry_limit" };
  if (input.status === 401 || input.status === 403 || input.status === 404) {
    return { retry: false, reason: "non_retryable_status" };
  }
  if (input.status === 429) {
    return {
      retry: true,
      delayMs: parseRetryAfter(input.retryAfter, input.now) ?? 5000,
      reason: "rate_limited"
    };
  }
  if (input.networkError || (input.status !== undefined && input.status >= 500)) {
    const random = input.random ?? Math.random;
    const delayMs = Math.round(500 * 2 ** input.attempt + random() * 250);
    return { retry: true, delayMs, reason: input.networkError ? "network_error" : "server_error" };
  }
  return { retry: false, reason: "not_retryable" };
}

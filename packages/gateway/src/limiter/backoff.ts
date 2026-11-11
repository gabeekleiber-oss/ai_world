export interface BackoffOptions {
  /** Delay before the first retry, before jitter. Default 1000 ms. */
  baseMs?: number;
  /** Ceiling for the computed delay. Default 60000 ms. */
  maxMs?: number;
  /** Server-suggested wait (Retry-After). It is a floor: the result is never shorter. */
  retryAfterMs?: number;
  /** Source of randomness in [0, 1). Default Math.random. */
  rng?: () => number;
}

/**
 * Exponential backoff with jitter. `attempt` counts retries from 0. The delay doubles each attempt up to
 * `maxMs`, and "equal jitter" keeps half of it fixed and randomises the other half, so concurrent
 * callers spread out without any of them retrying immediately.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 60_000;
  const rng = options.rng ?? Math.random;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  const jittered = exp / 2 + rng() * (exp / 2);
  return Math.max(Math.round(jittered), options.retryAfterMs ?? 0);
}

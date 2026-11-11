export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  /** Uniform random in [0, 1). Injected so tests are deterministic. */
  random?: () => number;
}

/**
 * Wait before retry number `attempt` (0 for the first retry) after a 429: exponential growth up to a cap, with jitter
 * that keeps the delay between half and all of the ceiling. A server Retry-After value is a floor.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}, retryAfterMs?: number): number {
  const { baseMs = 1000, capMs = 30_000, random = Math.random } = options;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const jittered = ceiling / 2 + random() * (ceiling / 2);
  return Math.round(Math.max(jittered, retryAfterMs ?? 0));
}

/**
 * Beat length in seconds (DESIGN.md section 10): `max(configured_beat_seconds, calls_needed / rpm_budget)`, with the
 * second term converted from minutes to seconds. When the budget binds, beats stretch instead of dropping decisions.
 */
export function adaptiveBeatSeconds(input: { configuredBeatSeconds: number; callsNeeded: number; rpmBudget: number }): number {
  const { configuredBeatSeconds, callsNeeded, rpmBudget } = input;
  if (!(rpmBudget > 0)) throw new RangeError("rpmBudget must be positive");
  return Math.max(configuredBeatSeconds, (Math.max(0, callsNeeded) / rpmBudget) * 60);
}

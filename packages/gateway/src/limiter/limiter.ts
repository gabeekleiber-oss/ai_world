import { ProviderError, isProviderError, type Provider, type ProviderPrompt, type ProviderResponse } from "../provider/types";
import { adaptiveBeatSeconds, backoffDelayMs, type BackoffOptions } from "./backoff";
import { CircuitBreaker, type CircuitBreakerOptions, type CircuitState } from "./circuit-breaker";
import { sleep, systemClock, type Clock } from "./clock";
import { OutageMonitor } from "./outage";
import { Slowdown, type SlowdownOptions } from "./slowdown";
import { TokenBucket } from "./token-bucket";

/** Thrown without calling the model while the circuit is open. Reads as a `server` failure to callers. */
export class CircuitOpenError extends ProviderError {
  readonly circuitOpen = true;
  declare readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("server", `circuit open, next probe in ${Math.ceil(retryAfterMs / 1000)} s`, { retryAfterMs });
    this.name = "CircuitOpenError";
  }
}

/** Notices for the log (`api_throttle`, `api_outage`) and the viewer banner. */
export type LimiterSignal =
  | { type: "throttle"; mindId?: string; attempt: number; backoffMs: number; retryAfterMs?: number; effectiveRpm: number; slowdownUntilMs: number }
  | { type: "circuit"; state: CircuitState; reopensAtMs?: number }
  | { type: "outage"; state: "started" | "ended"; sinceMs: number }
  | { type: "auth"; state: "failed" | "cleared"; message?: string };

export interface LimiterStatus {
  /** True when the scheduler should hold the world clock: an outage over 60 s, or a hard auth error. */
  paused: boolean;
  pauseReason: "outage" | "auth" | null;
  circuit: CircuitState;
  /** Rate now in force, after any 429 slowdown. */
  effectiveRpm: number;
  slowdownFactor: number;
}

export interface LimiterOptions {
  /** `llm.rpm_budget` from config. */
  rpmBudget: number;
  burst?: number;
  clock?: Clock;
  random?: () => number;
  /** How many times one call is retried after a 429 before the error goes to the caller. Default 3. */
  maxRateLimitRetries?: number;
  backoff?: Omit<BackoffOptions, "random">;
  slowdown?: Omit<SlowdownOptions, "clock" | "onChange">;
  breaker?: Omit<CircuitBreakerOptions, "clock" | "onStateChange">;
  outageAfterMs?: number;
  onSignal?: (signal: LimiterSignal) => void;
}

/** Limiter options from the `llm` block of the config. */
export function limiterOptionsFromConfig(llm: { rpm_budget: number }, extra: Omit<LimiterOptions, "rpmBudget"> = {}): LimiterOptions {
  return { ...extra, rpmBudget: llm.rpm_budget };
}

/**
 * Wraps a provider with the gateway's failure policy (DESIGN.md section 10):
 * - every call waits for a token (FIFO, evenly spaced);
 * - 429: exponential backoff with jitter (Retry-After is a floor), then retry; the limiter rate drops 20 percent for
 *   5 minutes and ramps back up;
 * - timeout and network errors: thrown as is, so the mind stands still this beat and retries next beat;
 * - 5xx: thrown as is; five in a row open the circuit for 60 s, during which calls fail at once without touching the API;
 * - no success for 60 s of failures: outage, `status().paused` is true until a call succeeds;
 * - hard auth error: paused and every later call fails at once, until `clearAuthFailure`.
 * It makes no format or retry decisions about model output; that is the decider's job.
 */
export class LimitedProvider implements Provider {
  readonly name: string;
  private readonly clock: Clock;
  private readonly baseRpm: number;
  private readonly bucket: TokenBucket;
  private readonly slowdown: Slowdown;
  private readonly breaker: CircuitBreaker;
  private readonly outage: OutageMonitor;
  private readonly maxRetries: number;
  private readonly backoff: BackoffOptions;
  private readonly listeners = new Set<(s: LimiterSignal) => void>();
  private authError: ProviderError | null = null;

  constructor(private readonly inner: Provider, options: LimiterOptions) {
    this.name = inner.name;
    this.clock = options.clock ?? systemClock;
    this.baseRpm = options.rpmBudget;
    this.maxRetries = options.maxRateLimitRetries ?? 3;
    this.backoff = { ...options.backoff, random: options.random ?? Math.random };
    if (options.onSignal) this.listeners.add(options.onSignal);
    this.bucket = new TokenBucket({ ratePerMinute: this.baseRpm, ...(options.burst !== undefined ? { burst: options.burst } : {}), clock: this.clock });
    this.slowdown = new Slowdown({ ...options.slowdown, clock: this.clock, onChange: (f) => this.bucket.setRatePerMinute(this.baseRpm * f) });
    this.breaker = new CircuitBreaker({ ...options.breaker, clock: this.clock, onStateChange: (state, reopensAtMs) => this.emit({ type: "circuit", state, ...(reopensAtMs !== undefined ? { reopensAtMs } : {}) }) });
    this.outage = new OutageMonitor({ clock: this.clock, ...(options.outageAfterMs !== undefined ? { thresholdMs: options.outageAfterMs } : {}), onChange: (state, sinceMs) => this.emit({ type: "outage", state, sinceMs }) });
  }

  /** Subscribe to signals. Returns an unsubscribe function. */
  onSignal(listener: (s: LimiterSignal) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  status(): LimiterStatus {
    const pauseReason = this.authError ? "auth" : this.outage.active ? "outage" : null;
    return { paused: pauseReason !== null, pauseReason, circuit: this.breaker.state, effectiveRpm: this.baseRpm * this.slowdown.factor, slowdownFactor: this.slowdown.factor };
  }

  /** Beat length for this many calls at the rate in force now: it stretches further while a slowdown holds. */
  beatSeconds(configuredBeatSeconds: number, callsNeeded: number): number {
    return adaptiveBeatSeconds({ configuredBeatSeconds, callsNeeded, rpmBudget: this.baseRpm * this.slowdown.factor });
  }

  /** After the owner fixes the key: allow calls again. */
  clearAuthFailure(): void {
    if (!this.authError) return;
    this.authError = null;
    this.emit({ type: "auth", state: "cleared" });
  }

  async decide(prompt: ProviderPrompt): Promise<ProviderResponse> {
    for (let attempt = 0; ; attempt++) {
      if (this.authError) throw this.authError;
      const permit = this.breaker.tryAcquire();
      if (!permit.ok) throw new CircuitOpenError(permit.retryAfterMs);
      try {
        await this.bucket.acquire(prompt.signal);
      } catch (e) {
        this.breaker.release();
        throw e;
      }
      try {
        const response = await this.inner.decide(prompt);
        this.breaker.recordSuccess();
        this.outage.recordSuccess();
        return response;
      } catch (e) {
        if (!isProviderError(e)) { this.breaker.release(); throw e; }
        switch (e.kind) {
          case "rate_limit": {
            this.breaker.release();
            this.outage.recordSuccess(); // the API answered
            this.slowdown.trigger();
            if (attempt >= this.maxRetries) throw e;
            const backoffMs = backoffDelayMs(attempt, this.backoff, e.retryAfterMs);
            this.emit({
              type: "throttle", ...(prompt.mindId !== undefined ? { mindId: prompt.mindId } : {}), attempt: attempt + 1, backoffMs,
              ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
              effectiveRpm: this.baseRpm * this.slowdown.factor, slowdownUntilMs: this.slowdown.holdUntilMs,
            });
            await sleep(this.clock, backoffMs, prompt.signal);
            continue;
          }
          case "server":
            this.breaker.recordServerFailure();
            this.outage.recordFailure();
            throw e;
          case "timeout":
          case "network":
            this.breaker.release();
            this.outage.recordFailure();
            throw e;
          case "auth":
            this.breaker.release();
            this.authError = e;
            this.emit({ type: "auth", state: "failed", message: e.message });
            throw e;
          case "bad_response":
            this.breaker.release();
            this.outage.recordSuccess(); // the API answered, the content was the problem
            throw e;
          default:
            this.breaker.release();
            throw e;
        }
      }
    }
  }

  private emit(signal: LimiterSignal): void {
    for (const l of this.listeners) l(signal);
  }
}

export function createLimitedProvider(inner: Provider, options: LimiterOptions): LimitedProvider {
  return new LimitedProvider(inner, options);
}

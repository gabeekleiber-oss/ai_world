import { ProviderError, isProviderError } from "../provider/types";
import { adaptiveBeatSeconds } from "./adaptive-beat";
import { backoffDelayMs, type BackoffOptions } from "./backoff";
import { CircuitBreaker, type BreakerState, type CircuitBreakerOptions } from "./circuit-breaker";
import { systemClock, type Clock } from "./clock";
import { RateGovernor, type RateGovernorOptions } from "./rate-governor";
import { TokenBucket } from "./token-bucket";

/**
 * What the rest of the system should do about the API:
 * - ok: carry on.
 * - outage: the API has failed continuously for over 60 s. Pause the world clock ("valley frozen"),
 *   keep calling, and resume when the status returns to ok.
 * - auth: the key was rejected. Pause and show an actionable message. Calls are refused until `resume()`.
 */
export type GatewayStatus = "ok" | "outage" | "auth";

export interface StatusChange {
  status: GatewayStatus;
  /** Clock time of the change. */
  at: number;
  /** Short plain message for the console or banner. Never contains the key. */
  message: string;
}

export interface LimiterOptions {
  /** Requests per minute (config llm.rpm_budget). */
  rpmBudget: number;
  clock?: Clock;
  /** Randomness for backoff jitter, in [0, 1). Default Math.random. */
  rng?: () => number;
  /** Largest burst the bucket allows. Default 1. */
  burst?: number;
  backoff?: Pick<BackoffOptions, "baseMs" | "maxMs"> & {
    /** Times one call is retried after a 429 before the error is returned to the caller. Default 3. */
    maxRetries?: number;
  };
  slowdown?: RateGovernorOptions;
  breaker?: CircuitBreakerOptions;
  /** Continuous failure time that counts as an outage. Default 60 s. */
  outageAfterMs?: number;
}

export interface RunOptions {
  /** Cancels waiting for a slot and any pending 429 retry. The beat barrier uses this for late calls. */
  signal?: AbortSignal;
  /** Clock time after which a 429 is not retried, because the beat would be over anyway. */
  deadlineAt?: number;
}

export interface LimiterStats {
  started: number;
  succeeded: number;
  rateLimited: number;
  retried: number;
  serverErrors: number;
  transientErrors: number;
  refusedByBreaker: number;
}

/**
 * The gateway's pacing layer (DESIGN.md section 10, failure table). One instance is shared by every
 * mind, so the limit holds for the whole gateway. Wrap each provider call in `run`.
 *
 * - Token bucket: at most `rpmBudget` requests per minute, first come first served.
 * - 429: exponential backoff with jitter (Retry-After is a floor), every caller waits out the backoff,
 *   the rate drops 20 percent for 5 minutes, then ramps back up.
 * - Timeout or network error: returned to the caller, who stands still this beat. Not retried here.
 * - 5xx: same, and 5 in a row open the circuit for 60 s. Calls are then refused at once.
 * - Over 60 s of continuous failure: status becomes "outage" until a call succeeds.
 * - Auth error: status "auth"; calls are refused until `resume()`.
 */
export class GatewayLimiter {
  private readonly clock: Clock;
  private readonly rng: () => number;
  private readonly governor: RateGovernor;
  private readonly bucket: TokenBucket;
  private readonly breaker: CircuitBreaker;
  private readonly backoff: LimiterOptions["backoff"];
  private readonly outageAfterMs: number;
  private currentStatus: GatewayStatus = "ok";
  private authError: ProviderError | null = null;
  private failureStreakStart: number | null = null;
  private readonly listeners = new Set<(change: StatusChange) => void>();
  private readonly counters: LimiterStats = { started: 0, succeeded: 0, rateLimited: 0, retried: 0, serverErrors: 0, transientErrors: 0, refusedByBreaker: 0 };

  constructor(options: LimiterOptions) {
    if (!(options.rpmBudget > 0)) throw new RangeError("rpmBudget must be positive");
    this.clock = options.clock ?? systemClock;
    this.rng = options.rng ?? Math.random;
    this.governor = new RateGovernor(this.clock, options.rpmBudget, options.slowdown);
    this.bucket = new TokenBucket({ clock: this.clock, ratePerMin: () => this.governor.rpm(), capacity: options.burst ?? 1 });
    this.breaker = new CircuitBreaker(this.clock, options.breaker);
    this.backoff = options.backoff;
    this.outageAfterMs = options.outageAfterMs ?? 60_000;
  }

  /** Current time on the limiter's clock. */
  now(): number {
    return this.clock.now();
  }

  get status(): GatewayStatus {
    return this.currentStatus;
  }

  /** Requests per minute allowed right now (below the budget while slowed after a 429). */
  get currentRpm(): number {
    return this.governor.rpm();
  }

  get slowed(): boolean {
    return this.governor.slowed;
  }

  get breakerState(): BreakerState {
    return this.breaker.current;
  }

  get stats(): Readonly<LimiterStats> {
    return { ...this.counters };
  }

  /** Beat length in seconds for this many calls, using the rate allowed right now. */
  beatSeconds(configuredBeatSeconds: number, callsNeeded: number): number {
    return adaptiveBeatSeconds(configuredBeatSeconds, callsNeeded, this.governor.rpm());
  }

  /** Be told when the status changes. Returns a function that stops the notifications. */
  onStatus(listener: (change: StatusChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lift an auth pause, for example after the person fixed the key. */
  resume(): void {
    if (this.currentStatus !== "auth") return;
    this.authError = null;
    this.setStatus("ok", "resumed after an authentication pause");
  }

  async run<T>(call: () => Promise<T>, options: RunOptions = {}): Promise<T> {
    const { signal, deadlineAt } = options;
    for (let attempt = 0; ; attempt++) {
      if (this.authError) throw this.authError;
      this.refuseIfBreakerOpen();
      await this.bucket.acquire(signal);
      if (this.authError) throw this.authError;
      if (signal?.aborted) throw new ProviderError("aborted", "call cancelled before it started");
      this.refuseIfBreakerOpen(true);

      this.counters.started += 1;
      try {
        const result = await call();
        this.onSuccess();
        return result;
      } catch (error) {
        if (!isProviderError(error)) {
          this.breaker.release();
          throw error;
        }
        this.onFailure(error);
        if (error.kind !== "rate_limit" || attempt >= (this.backoff?.maxRetries ?? 3)) throw error;
        const delay = backoffDelayMs(attempt, { ...this.backoff, rng: this.rng, ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}) });
        if (deadlineAt !== undefined && this.clock.now() + delay >= deadlineAt) throw error;
        this.bucket.blockUntil(this.clock.now() + delay);
        this.counters.retried += 1;
      }
    }
  }

  private refuseIfBreakerOpen(reserveProbe = false): void {
    try {
      if (reserveProbe) this.breaker.beforeCall();
      else if (this.breaker.blocking) this.breaker.beforeCall();
    } catch (error) {
      this.counters.refusedByBreaker += 1;
      this.checkOutage();
      throw error;
    }
  }

  private onSuccess(): void {
    this.counters.succeeded += 1;
    this.breaker.reachable();
    this.clearFailureStreak();
  }

  private onFailure(error: ProviderError): void {
    switch (error.kind) {
      case "rate_limit":
        this.counters.rateLimited += 1;
        this.breaker.reachable();
        this.clearFailureStreak();
        this.governor.on429();
        this.bucket.poke();
        break;
      case "server":
        this.counters.serverErrors += 1;
        this.breaker.serverFailure();
        this.noteTransientFailure();
        break;
      case "timeout":
      case "network":
        this.counters.transientErrors += 1;
        this.breaker.transientFailure();
        this.noteTransientFailure();
        break;
      case "bad_response":
        this.breaker.reachable();
        this.clearFailureStreak();
        break;
      case "auth":
        this.breaker.release();
        this.authError = error;
        this.setStatus("auth", "the API rejected the key; check NVIDIA_API_KEY, then resume");
        break;
      case "aborted":
        this.breaker.release();
        break;
    }
  }

  private noteTransientFailure(): void {
    if (this.failureStreakStart === null) this.failureStreakStart = this.clock.now();
    this.checkOutage();
  }

  private clearFailureStreak(): void {
    this.failureStreakStart = null;
    if (this.currentStatus === "outage") this.setStatus("ok", "the API is answering again");
  }

  private checkOutage(): void {
    if (this.currentStatus !== "ok" || this.failureStreakStart === null) return;
    if (this.clock.now() - this.failureStreakStart >= this.outageAfterMs) {
      this.setStatus("outage", "the API has not answered for over a minute; the valley is frozen until it does");
    }
  }

  private setStatus(status: GatewayStatus, message: string): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    const change: StatusChange = { status, at: this.clock.now(), message };
    for (const listener of [...this.listeners]) listener(change);
  }
}

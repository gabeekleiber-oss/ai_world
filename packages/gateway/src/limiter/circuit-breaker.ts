import { ProviderError } from "../provider/types";
import type { Clock } from "./clock";

export type BreakerState = "closed" | "open" | "half_open";

/**
 * Thrown instead of calling the provider while the breaker is open. It is a "server" failure for the
 * caller, so the mind stands still this beat and nothing waits. It is never counted against the
 * breaker again.
 */
export class CircuitOpenError extends ProviderError {
  /** Clock time after which a probe call will be let through. */
  readonly retryAtMs: number;

  constructor(retryAtMs: number, retryAfterMs: number) {
    super("server", "circuit open: skipping call after repeated server errors", { retryAfterMs });
    this.name = "CircuitOpenError";
    this.retryAtMs = retryAtMs;
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive 5xx responses that open the circuit. Default 5. */
  threshold?: number;
  /** How long the circuit stays open before one probe is allowed. Default 60 s. */
  openMs?: number;
}

/**
 * DESIGN.md section 10: "5xx: same as timeout; if 5 in a row, circuit-open for 60 s".
 * After the open period one probe call is let through (half open). Success closes the circuit; a
 * server error or timeout on the probe opens it again for another full period.
 */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly openMs: number;
  private state: BreakerState = "closed";
  private failures = 0;
  private openUntil = 0;
  private probeInFlight = false;

  constructor(
    private readonly clock: Clock,
    options: CircuitBreakerOptions = {},
  ) {
    this.threshold = options.threshold ?? 5;
    this.openMs = options.openMs ?? 60_000;
  }

  get current(): BreakerState {
    return this.state;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  /** Cheap check with no side effects: would a call be refused right now? */
  get blocking(): boolean {
    return this.state === "open" && this.clock.now() < this.openUntil;
  }

  get retryAt(): number {
    return this.openUntil;
  }

  /** Call right before sending. Throws CircuitOpenError when the call must not go out; reserves the probe slot when it is the probe. */
  beforeCall(): void {
    const now = this.clock.now();
    if (this.state === "open") {
      if (now < this.openUntil) throw new CircuitOpenError(this.openUntil, this.openUntil - now);
      this.state = "half_open";
    }
    if (this.state === "half_open") {
      if (this.probeInFlight) throw new CircuitOpenError(this.openUntil, 1000);
      this.probeInFlight = true;
    }
  }

  /** The API answered in a way that shows it is up (success, 429 or a malformed body). */
  reachable(): void {
    this.failures = 0;
    this.state = "closed";
    this.probeInFlight = false;
  }

  serverFailure(): void {
    if (this.state === "half_open") return this.open();
    this.failures += 1;
    if (this.failures >= this.threshold) this.open();
  }

  /** Timeout or network error. It does not add to the 5xx streak, but a failed probe re-opens the circuit. */
  transientFailure(): void {
    if (this.state === "half_open") this.open();
  }

  /** The call that reserved the probe slot ended without a verdict (cancelled). */
  release(): void {
    this.probeInFlight = false;
  }

  private open(): void {
    this.state = "open";
    this.openUntil = this.clock.now() + this.openMs;
    this.failures = 0;
    this.probeInFlight = false;
  }
}

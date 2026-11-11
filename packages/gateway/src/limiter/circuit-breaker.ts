import type { Clock } from "./clock";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  clock: Clock;
  /** Consecutive 5xx answers that open the circuit. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open. Default 60 s. */
  openMs?: number;
  onStateChange?: (state: CircuitState, reopensAtMs?: number) => void;
}

export type Permit = { ok: true; probe: boolean } | { ok: false; retryAfterMs: number };

/**
 * Circuit breaker for 5xx answers (DESIGN.md section 10). Five in a row open it for 60 s. After that one probe call is
 * let through: success closes it, a 5xx opens it again. Only a success resets the run; timeouts and 429s neither add
 * to it nor clear it.
 */
export class CircuitBreaker {
  private readonly clock: Clock;
  private readonly threshold: number;
  private readonly openMs: number;
  private readonly notify: (state: CircuitState, reopensAtMs?: number) => void;
  private current: CircuitState = "closed";
  private failures = 0;
  private reopenAt = 0;
  private probing = false;
  private cancel: (() => void) | null = null;

  constructor(options: CircuitBreakerOptions) {
    this.clock = options.clock;
    this.threshold = options.failureThreshold ?? 5;
    this.openMs = options.openMs ?? 60_000;
    this.notify = options.onStateChange ?? (() => {});
  }

  get state(): CircuitState {
    return this.current;
  }

  tryAcquire(): Permit {
    if (this.current === "closed") return { ok: true, probe: false };
    if (this.current === "open") return { ok: false, retryAfterMs: Math.max(0, this.reopenAt - this.clock.now()) };
    if (this.probing) return { ok: false, retryAfterMs: 1000 };
    this.probing = true;
    return { ok: true, probe: true };
  }

  recordSuccess(): void {
    this.failures = 0;
    this.probing = false;
    if (this.current !== "closed") this.to("closed");
  }

  recordServerFailure(): void {
    this.probing = false;
    if (this.current === "half_open") return this.open();
    if (this.current === "closed" && ++this.failures >= this.threshold) this.open();
  }

  /** A call ended in some way that says nothing about server health. Frees the probe slot. */
  release(): void {
    this.probing = false;
  }

  private open(): void {
    this.reopenAt = this.clock.now() + this.openMs;
    this.cancel?.();
    this.cancel = this.clock.setTimer(this.openMs, () => { this.cancel = null; this.to("half_open"); });
    this.to("open");
  }

  private to(state: CircuitState): void {
    this.current = state;
    if (state === "closed") { this.cancel?.(); this.cancel = null; }
    this.notify(state, state === "open" ? this.reopenAt : undefined);
  }
}

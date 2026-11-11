import { ProviderError } from "../provider/types";
import { systemClock, type Clock } from "./clock";

export interface TokenBucketOptions {
  /** Sustained rate, in calls per minute. */
  ratePerMinute: number;
  /** Bucket size: how many calls may go out back to back. Default 1 (calls are evenly spaced). */
  burst?: number;
  clock?: Clock;
}

interface Waiter {
  resolve: () => void;
  reject: (e: unknown) => void;
  detach: () => void;
}

const EPS = 1e-9;

/**
 * Token bucket with a first-in first-out queue (DESIGN.md section 10). With the default burst of 1, any half-open
 * 60 s window holds at most `ratePerMinute` call starts. The rate can change while callers wait (429 slowdown).
 */
export class TokenBucket {
  private readonly clock: Clock;
  private readonly burst: number;
  private ratePerMs: number;
  private tokens: number;
  private last: number;
  private readonly queue: Waiter[] = [];
  private cancelTimer: (() => void) | null = null;

  constructor(options: TokenBucketOptions) {
    if (!(options.ratePerMinute > 0)) throw new RangeError("ratePerMinute must be positive");
    this.burst = options.burst ?? 1;
    if (!(this.burst >= 1)) throw new RangeError("burst must be at least 1");
    this.clock = options.clock ?? systemClock;
    this.ratePerMs = options.ratePerMinute / 60_000;
    this.tokens = this.burst;
    this.last = this.clock.now();
  }

  get ratePerMinute(): number {
    return this.ratePerMs * 60_000;
  }

  get queued(): number {
    return this.queue.length;
  }

  setRatePerMinute(ratePerMinute: number): void {
    if (!(ratePerMinute > 0)) throw new RangeError("ratePerMinute must be positive");
    this.refill(); // credit time already passed at the old rate
    this.ratePerMs = ratePerMinute / 60_000;
    this.pump();
  }

  /** Resolves when the caller may make one call. Rejects with `aborted` if the signal fires first. */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new ProviderError("aborted", "cancelled while waiting for the rate limiter"));
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, detach: () => signal?.removeEventListener("abort", onAbort) };
      const onAbort = (): void => {
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
        reject(new ProviderError("aborted", "cancelled while waiting for the rate limiter"));
        if (this.queue.length === 0) this.clearTimer();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
      this.pump();
    });
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.last) * this.ratePerMs);
    this.last = now;
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private pump(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1 - EPS) {
      this.tokens -= 1;
      const waiter = this.queue.shift()!;
      waiter.detach();
      waiter.resolve();
    }
    this.clearTimer();
    if (this.queue.length === 0) return;
    const waitMs = Math.max(1, Math.ceil((1 - this.tokens) / this.ratePerMs - EPS));
    this.cancelTimer = this.clock.setTimer(waitMs, () => { this.cancelTimer = null; this.pump(); });
  }
}

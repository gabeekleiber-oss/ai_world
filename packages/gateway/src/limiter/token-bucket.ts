import { ProviderError } from "../provider/types";
import type { Clock } from "./clock";

export interface TokenBucketOptions {
  clock: Clock;
  /** Current allowed rate in requests per minute. Read on every refill, so it may change over time. */
  ratePerMin: () => number;
  /** Largest burst. Default 1, which spaces calls evenly at the configured rate. */
  capacity?: number;
}

interface Waiter {
  resolve(): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const EPSILON = 1e-9;

/**
 * Token bucket with a first-come first-served queue (DESIGN.md section 10: "through a token-bucket
 * rate limiter"). Waiters are served in order, so no mind is favoured. A waiter whose signal aborts
 * leaves the queue without spending a token, so late calls discarded at the beat barrier cost nothing.
 *
 * Refill uses the rate read at refill time. While the rate ramps back up after a slowdown this is
 * slightly generous over one short wait; it is not generous when the rate drops.
 */
export class TokenBucket {
  private readonly clock: Clock;
  private readonly ratePerMin: () => number;
  private readonly capacity: number;
  private tokens: number;
  private last: number;
  private blockedUntil = 0;
  private timerGeneration = 0;
  private readonly queue: Waiter[] = [];

  constructor(options: TokenBucketOptions) {
    this.clock = options.clock;
    this.ratePerMin = options.ratePerMin;
    this.capacity = Math.max(1, options.capacity ?? 1);
    this.tokens = this.capacity;
    this.last = this.clock.now();
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** Resolves when the caller may send one request. Rejects with an "aborted" ProviderError if the signal fires first. */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortedError());
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (signal) {
        waiter.signal = signal;
        waiter.onAbort = () => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          reject(abortedError());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.pump();
    });
  }

  /** Nobody is served before this time. Used after a 429 so every caller backs off, not just the one that was refused. */
  blockUntil(time: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, time);
    this.pump();
  }

  /** Re-evaluate the queue now, for example after the rate changed. */
  poke(): void {
    this.pump();
  }

  private refill(now: number): void {
    const rate = this.ratePerMin();
    const elapsed = Math.max(0, now - this.last);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * rate) / 60_000);
    this.last = now;
  }

  private pump(): void {
    const now = this.clock.now();
    this.refill(now);
    if (this.queue.length === 0) return;
    if (now < this.blockedUntil) {
      this.schedule(this.blockedUntil - now);
      return;
    }
    while (this.queue.length > 0 && this.tokens >= 1 - EPSILON) {
      this.tokens -= 1;
      const waiter = this.queue.shift()!;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve();
    }
    if (this.queue.length > 0) {
      const rate = Math.max(this.ratePerMin(), EPSILON);
      this.schedule(((1 - this.tokens) * 60_000) / rate);
    }
  }

  private schedule(ms: number): void {
    const generation = ++this.timerGeneration;
    void this.clock.sleep(Math.max(1, Math.ceil(ms))).then(() => {
      if (generation === this.timerGeneration) this.pump();
    });
  }
}

function abortedError(): ProviderError {
  return new ProviderError("aborted", "wait for a request slot was cancelled");
}

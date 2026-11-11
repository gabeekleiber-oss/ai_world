import { ProviderError } from "../provider/types";

/** Time source for the limiter. Injected so tests run on a manual clock and never wait in real time. */
export interface Clock {
  now(): number;
  /** Run `fn` after `ms` milliseconds. Returns a function that cancels the timer. */
  setTimer(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(ms, fn) {
    const handle = setTimeout(fn, Math.max(0, ms));
    return () => clearTimeout(handle);
  },
};

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Deterministic clock for tests. Time only moves when `advance` is called. */
export class ManualClock implements Clock {
  private time: number;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimer(ms: number, fn: () => void): () => void {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return () => void this.timers.delete(id);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Move time forward, firing due timers in order and letting awaiting code run between them. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await flush(); // let work that is already waiting start before time moves
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && (t.at < nextAt || (t.at === nextAt && id < nextId))) { nextId = id; nextAt = t.at; }
      }
      if (nextId < 0) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.time = Math.max(this.time, timer.at);
      timer.fn();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

/** Wait `ms` on the clock. Rejects with an `aborted` ProviderError if the signal fires first. */
export function sleep(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError("aborted", "cancelled while waiting"));
    let cancel: () => void = () => {};
    const onAbort = (): void => { cancel(); reject(new ProviderError("aborted", "cancelled while waiting")); };
    cancel = clock.setTimer(ms, () => { signal?.removeEventListener("abort", onAbort); resolve(); });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

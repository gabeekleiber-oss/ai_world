/**
 * Time source for the limiter. Everything in this folder reads time and sleeps through a Clock,
 * so tests drive it with ManualClock and never wait in real time.
 */
export interface Clock {
  /** Milliseconds on a monotonic-enough scale. Only differences matter. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

/** Test clock. Time moves only when `advance` is called; timers fire in order as it passes them. */
export class ManualClock implements Clock {
  private time: number;
  private nextId = 0;
  private timers: Array<{ id: number; due: number; resolve: () => void }> = [];

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push({ id: this.nextId++, due: this.time + Math.max(0, ms), resolve });
    });
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Move time forward, firing due timers in order and letting awaiting code run after each one. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await settle();
    for (;;) {
      const due = this.timers.filter((t) => t.due <= target).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.time = Math.max(this.time, due.due);
      due.resolve();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

/** Let all queued microtasks (and the async chains they start) run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

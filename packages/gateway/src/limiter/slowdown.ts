import type { Clock } from "./clock";

export interface SlowdownOptions {
  clock: Clock;
  /** Share removed from the rate on a 429. Default 0.2. */
  reduction?: number;
  /** How long the reduced rate holds. Default 5 minutes. */
  holdMs?: number;
  /** The rate then climbs back in this many equal steps. Default 4. */
  rampSteps?: number;
  rampStepMs?: number;
  onChange: (factor: number) => void;
}

/** Rate multiplier after a 429: drops by 20 percent, holds for 5 minutes, then ramps back up (DESIGN.md section 10). */
export class Slowdown {
  private readonly o: Required<Omit<SlowdownOptions, "onChange" | "clock">> & Pick<SlowdownOptions, "onChange" | "clock">;
  private current = 1;
  private until = 0;
  private cancel: (() => void) | null = null;

  constructor(options: SlowdownOptions) {
    this.o = { reduction: 0.2, holdMs: 300_000, rampSteps: 4, rampStepMs: 30_000, ...options };
  }

  get factor(): number {
    return this.current;
  }

  /** Time (clock ms) when the reduced rate stops holding and the ramp begins. 0 when not slowed. */
  get holdUntilMs(): number {
    return this.current < 1 ? this.until : 0;
  }

  /** A 429 arrived. Resets the hold window; repeated 429s do not compound the reduction. */
  trigger(): void {
    this.cancel?.();
    this.until = this.o.clock.now() + this.o.holdMs;
    this.set(1 - this.o.reduction);
    this.cancel = this.o.clock.setTimer(this.o.holdMs, () => this.step(1));
  }

  private step(i: number): void {
    const done = i >= this.o.rampSteps;
    this.set(done ? 1 : 1 - this.o.reduction + (this.o.reduction * i) / this.o.rampSteps);
    this.cancel = done ? null : this.o.clock.setTimer(this.o.rampStepMs, () => this.step(i + 1));
  }

  private set(factor: number): void {
    if (factor === this.current) return;
    this.current = factor;
    this.o.onChange(factor);
  }
}

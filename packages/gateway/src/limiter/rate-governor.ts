import type { Clock } from "./clock";

export interface RateGovernorOptions {
  /** Multiplier applied on each 429. Default 0.8, which is the 20 percent slowdown in DESIGN.md section 10. */
  rateFactor?: number;
  /** How long the slowed rate is held. Default 5 minutes. */
  holdMs?: number;
  /** How long the climb back to the full rate takes after the hold. Default 2 minutes. */
  rampMs?: number;
  /** The rate never drops below this fraction of the base, however many 429s arrive. Default 0.25. */
  minFraction?: number;
}

/**
 * Owns the current allowed rate. A 429 lowers it by 20 percent for 5 minutes, then it ramps back up
 * linearly. Another 429 while slowed or ramping compounds from the current rate (bounded by
 * `minFraction`) and restarts the hold.
 */
export class RateGovernor {
  private readonly rateFactor: number;
  private readonly holdMs: number;
  private readonly rampMs: number;
  private readonly minFraction: number;
  private floor = 1;
  private holdUntil = 0;

  constructor(
    private readonly clock: Clock,
    private baseRpm: number,
    options: RateGovernorOptions = {},
  ) {
    this.rateFactor = options.rateFactor ?? 0.8;
    this.holdMs = options.holdMs ?? 5 * 60_000;
    this.rampMs = options.rampMs ?? 2 * 60_000;
    this.minFraction = options.minFraction ?? 0.25;
  }

  get base(): number {
    return this.baseRpm;
  }

  setBase(rpm: number): void {
    this.baseRpm = rpm;
  }

  /** Fraction of the base rate allowed now, in (0, 1]. */
  fraction(now = this.clock.now()): number {
    if (this.floor >= 1) return 1;
    if (now < this.holdUntil) return this.floor;
    const ramped = this.floor + ((1 - this.floor) * (now - this.holdUntil)) / this.rampMs;
    return Math.min(1, ramped);
  }

  /** Allowed requests per minute right now. */
  rpm(now = this.clock.now()): number {
    return this.baseRpm * this.fraction(now);
  }

  /** True while the rate is below the base, whether held or ramping. */
  get slowed(): boolean {
    return this.fraction() < 1;
  }

  on429(now = this.clock.now()): void {
    this.floor = Math.max(this.minFraction, this.fraction(now) * this.rateFactor);
    this.holdUntil = now + this.holdMs;
  }
}

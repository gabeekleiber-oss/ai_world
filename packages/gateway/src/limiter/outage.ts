import type { Clock } from "./clock";

export interface OutageMonitorOptions {
  clock: Clock;
  /** Continuous failure time before the world should pause. Default 60 s. */
  thresholdMs?: number;
  onChange: (state: "started" | "ended", sinceMs: number) => void;
}

/**
 * Tracks an API outage (DESIGN.md section 10). Timeouts, network errors and 5xx answers start a run; if no call
 * succeeds for the threshold, the outage is declared and the world should pause. The next success ends it.
 */
export class OutageMonitor {
  private readonly clock: Clock;
  private readonly thresholdMs: number;
  private readonly onChange: OutageMonitorOptions["onChange"];
  private runStart: number | null = null;
  private declared = false;
  private cancel: (() => void) | null = null;

  constructor(options: OutageMonitorOptions) {
    this.clock = options.clock;
    this.thresholdMs = options.thresholdMs ?? 60_000;
    this.onChange = options.onChange;
  }

  get active(): boolean {
    return this.declared;
  }

  recordFailure(): void {
    if (this.runStart !== null) return;
    this.runStart = this.clock.now();
    this.cancel = this.clock.setTimer(this.thresholdMs, () => {
      this.cancel = null;
      if (this.runStart === null) return;
      this.declared = true;
      this.onChange("started", this.runStart);
    });
  }

  recordSuccess(): void {
    const since = this.runStart;
    this.runStart = null;
    this.cancel?.();
    this.cancel = null;
    if (this.declared && since !== null) {
      this.declared = false;
      this.onChange("ended", since);
    }
  }
}

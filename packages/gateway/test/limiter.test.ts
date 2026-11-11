import { describe, expect, it } from "vitest";
import { ProviderError, type Provider, type ProviderErrorKind, type ProviderResponse } from "../src/provider";
import {
  CircuitOpenError, ManualClock, Slowdown, TokenBucket, adaptiveBeatSeconds, backoffDelayMs, createLimitedProvider, limiterOptionsFromConfig,
  type LimiterSignal,
} from "../src/limiter";

type Step = "ok" | { fail: ProviderErrorKind; retryAfterMs?: number };

/** Provider stub on the manual clock. Records when each call started. */
class Scripted implements Provider {
  readonly name = "scripted";
  readonly starts: number[] = [];
  constructor(private readonly clock: ManualClock, private script: (i: number) => Step) {}
  setScript(script: (i: number) => Step): void { this.script = script; }
  async decide(): Promise<ProviderResponse> {
    const i = this.starts.length;
    this.starts.push(this.clock.now());
    const step = this.script(i);
    if (step === "ok") return { text: "ok", latencyMs: 0 };
    throw new ProviderError(step.fail, `scripted ${step.fail}`, { retryAfterMs: step.retryAfterMs });
  }
}

const prompt = (mindId = "m0") => ({ system: "s", user: "u", mindId });
const settle = <T>(p: Promise<T>) => p.then((value) => ({ value }), (error: unknown) => ({ error }));
const MIN = 60_000;

function maxInWindow(times: number[], windowMs: number): number {
  let best = 0;
  for (const t of times) best = Math.max(best, times.filter((x) => x >= t && x < t + windowMs).length);
  return best;
}

describe("TokenBucket", () => {
  it("spaces calls evenly at the configured rate, first in first out", async () => {
    const clock = new ManualClock();
    const bucket = new TokenBucket({ ratePerMinute: 30, clock });
    const at: number[] = [];
    const order: number[] = [];
    for (let i = 0; i < 5; i++) void bucket.acquire().then(() => { at.push(clock.now()); order.push(i); });
    await clock.advance(10_000);
    expect(at).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("allows a burst up to its size and refills over time", async () => {
    const clock = new ManualClock();
    const bucket = new TokenBucket({ ratePerMinute: 60, burst: 3, clock });
    const at: number[] = [];
    for (let i = 0; i < 5; i++) void bucket.acquire().then(() => at.push(clock.now()));
    await clock.advance(5000);
    expect(at).toEqual([0, 0, 0, 1000, 2000]);
  });

  it("applies a lowered rate to callers that are already waiting", async () => {
    const clock = new ManualClock();
    const bucket = new TokenBucket({ ratePerMinute: 30, clock });
    const at: number[] = [];
    for (let i = 0; i < 3; i++) void bucket.acquire().then(() => at.push(clock.now()));
    await clock.advance(1000);
    bucket.setRatePerMinute(15); // 4 s apart; the half token already earned still counts
    await clock.advance(10_000);
    expect(at).toEqual([0, 3000, 7000]);
  });

  it("rejects a waiting caller that is cancelled and keeps the others in order", async () => {
    const clock = new ManualClock();
    const bucket = new TokenBucket({ ratePerMinute: 30, clock });
    const ctl = new AbortController();
    const at: number[] = [];
    void bucket.acquire().then(() => at.push(clock.now()));
    const cancelled = settle(bucket.acquire(ctl.signal));
    void bucket.acquire().then(() => at.push(clock.now()));
    await clock.advance(500);
    ctl.abort();
    expect(((await cancelled) as { error: ProviderError }).error.kind).toBe("aborted");
    await clock.advance(5000);
    expect(at).toEqual([0, 2000]);
    expect(bucket.queued).toBe(0);
  });

  it("rejects an already cancelled caller at once", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const bucket = new TokenBucket({ ratePerMinute: 30, clock: new ManualClock() });
    expect(((await settle(bucket.acquire(ctl.signal))) as { error: ProviderError }).error.kind).toBe("aborted");
  });
});

describe("beat length and backoff", () => {
  it("stretches the beat when calls per minute exceed the budget", () => {
    expect(adaptiveBeatSeconds({ configuredBeatSeconds: 6, callsNeeded: 4, rpmBudget: 30 })).toBe(8);
    expect(adaptiveBeatSeconds({ configuredBeatSeconds: 6, callsNeeded: 2, rpmBudget: 30 })).toBe(6);
    expect(adaptiveBeatSeconds({ configuredBeatSeconds: 6, callsNeeded: 0, rpmBudget: 30 })).toBe(6);
    expect(() => adaptiveBeatSeconds({ configuredBeatSeconds: 6, callsNeeded: 1, rpmBudget: 0 })).toThrow();
  });

  it("grows exponentially with jitter, up to the cap, with Retry-After as a floor", () => {
    const lo = { random: () => 0 };
    const hi = { random: () => 0.999999 };
    expect(backoffDelayMs(0, lo)).toBe(500);
    expect(backoffDelayMs(0, hi)).toBe(1000);
    expect(backoffDelayMs(2, lo)).toBe(2000);
    expect(backoffDelayMs(2, hi)).toBe(4000);
    expect(backoffDelayMs(20, hi)).toBe(30_000);
    expect(backoffDelayMs(0, lo, 12_000)).toBe(12_000);
    expect(backoffDelayMs(0, { baseMs: 100, capMs: 800, random: () => 0 })).toBe(50);
  });
});

describe("Slowdown", () => {
  it("drops 20 percent, holds 5 minutes, then ramps back to full", async () => {
    const clock = new ManualClock();
    const seen: number[] = [];
    const slow = new Slowdown({ clock, onChange: (f) => seen.push(f) });
    slow.trigger();
    expect(slow.factor).toBeCloseTo(0.8);
    await clock.advance(5 * MIN - 1);
    expect(slow.factor).toBeCloseTo(0.8);
    await clock.advance(1);
    expect(slow.factor).toBeCloseTo(0.85);
    await clock.advance(2 * 30_000);
    expect(slow.factor).toBeCloseTo(0.95);
    await clock.advance(30_000);
    expect(slow.factor).toBe(1);
    expect(clock.pendingTimers).toBe(0);
    expect(seen.map((f) => +f.toFixed(2))).toEqual([0.8, 0.85, 0.9, 0.95, 1]);
  });

  it("restarts the hold on another 429 without compounding", async () => {
    const clock = new ManualClock();
    const slow = new Slowdown({ clock, onChange: () => {} });
    slow.trigger();
    await clock.advance(4 * MIN);
    slow.trigger();
    await clock.advance(4 * MIN);
    expect(slow.factor).toBeCloseTo(0.8);
    await clock.advance(MIN + 30_000); // 5.5 min after the second 429: hold over, one ramp step taken
    expect(slow.factor).toBeCloseTo(0.9);
  });
});

describe("LimitedProvider: rate limiting and 429", () => {
  it("holds the limit under injected 429s, retries them, and slows down for 5 minutes", async () => {
    const clock = new ManualClock();
    const signals: LimiterSignal[] = [];
    const inner = new Scripted(clock, (i) => (i < 6 ? { fail: "rate_limit", retryAfterMs: 1000 } : "ok"));
    const lp = createLimitedProvider(inner, { rpmBudget: 30, clock, random: () => 0.5, onSignal: (s) => signals.push(s) });
    const results = Array.from({ length: 10 }, (_, i) => settle(lp.decide(prompt(`m${i}`))));
    await clock.advance(10 * MIN);
    const settled = await Promise.all(results);

    expect(settled.every((r) => "value" in r)).toBe(true);
    expect(inner.starts.length).toBe(16); // 10 calls plus 6 retries
    expect(maxInWindow(inner.starts, MIN)).toBeLessThanOrEqual(30);
    const gaps = inner.starts.slice(1).map((t, i) => t - inner.starts[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2000);
    // After the last 429, spacing is at the lowered rate (24 per minute) for as long as the slowdown holds.
    const lastFailAt = inner.starts[5]!;
    const held = inner.starts.filter((t) => t > lastFailAt && t < lastFailAt + 5 * MIN);
    expect(Math.min(...held.slice(1).map((t, i) => t - held[i]!))).toBeGreaterThanOrEqual(2500);
    expect(signals.filter((s) => s.type === "throttle")).toHaveLength(6);
    expect(lp.status().slowdownFactor).toBe(1); // 10 minutes later the rate is back to full
  });

  it("waits at least Retry-After before the retry", async () => {
    const clock = new ManualClock();
    const inner = new Scripted(clock, (i) => (i === 0 ? { fail: "rate_limit", retryAfterMs: 10_000 } : "ok"));
    const lp = createLimitedProvider(inner, { rpmBudget: 30, clock, random: () => 0 });
    const done = settle(lp.decide(prompt()));
    await clock.advance(9000);
    expect(inner.starts).toEqual([0]);
    await clock.advance(5000);
    expect("value" in (await done)).toBe(true);
    expect(inner.starts[1]).toBeGreaterThanOrEqual(10_000);
  });

  it("gives the 429 to the caller after the retry limit", async () => {
    const clock = new ManualClock();
    const inner = new Scripted(clock, () => ({ fail: "rate_limit" }));
    const lp = createLimitedProvider(inner, { rpmBudget: 30, clock, random: () => 0.5, maxRateLimitRetries: 2 });
    const done = settle(lp.decide(prompt()));
    await clock.advance(5 * MIN);
    expect(((await done) as { error: ProviderError }).error.kind).toBe("rate_limit");
    expect(inner.starts.length).toBe(3);
  });

  it("stretches the beat while the slowdown holds", async () => {
    const clock = new ManualClock();
    const inner = new Scripted(clock, (i) => (i === 0 ? { fail: "rate_limit" } : "ok"));
    const lp = createLimitedProvider(inner, { rpmBudget: 30, clock, random: () => 0 });
    expect(lp.beatSeconds(6, 4)).toBe(8);
    const done = settle(lp.decide(prompt()));
    await clock.advance(10_000);
    await done;
    expect(lp.status().effectiveRpm).toBeCloseTo(24);
    expect(lp.beatSeconds(6, 4)).toBeCloseTo(10);
    await clock.advance(10 * MIN);
    expect(lp.beatSeconds(6, 4)).toBe(8);
  });

  it("stops waiting for the limiter or for a backoff when the caller cancels", async () => {
    const clock = new ManualClock();
    const inner = new Scripted(clock, (i) => (i === 0 ? { fail: "rate_limit", retryAfterMs: 60_000 } : "ok"));
    const lp = createLimitedProvider(inner, { rpmBudget: 30, clock, random: () => 0 });
    const ctl = new AbortController();
    const done = settle(lp.decide({ ...prompt(), signal: ctl.signal }));
    await clock.advance(5000);
    ctl.abort();
    expect(((await done) as { error: ProviderError }).error.kind).toBe("aborted");
    expect(inner.starts.length).toBe(1);
  });

  it("does not retry timeouts or network errors; the mind stands still this beat", async () => {
    const clock = new ManualClock();
    for (const kind of ["timeout", "network"] as const) {
      const inner = new Scripted(clock, () => ({ fail: kind }));
      const lp = createLimitedProvider(inner, { rpmBudget: 30, clock });
      expect(((await settle(lp.decide(prompt()))) as { error: ProviderError }).error.kind).toBe(kind);
      expect(inner.starts.length).toBe(1);
      expect(lp.status().slowdownFactor).toBe(1);
    }
  });

  it("builds options from the llm config block", () => {
    expect(limiterOptionsFromConfig({ rpm_budget: 12 }, { burst: 2 })).toEqual({ rpmBudget: 12, burst: 2 });
  });
});

describe("LimitedProvider: circuit breaker", () => {
  const fast = (clock: ManualClock, inner: Provider, signals: LimiterSignal[]) =>
    createLimitedProvider(inner, { rpmBudget: 600, burst: 20, clock, onSignal: (s) => signals.push(s) });

  it("opens after 5 server errors in a row, fails fast for 60 s, then recovers on a good probe", async () => {
    const clock = new ManualClock();
    const signals: LimiterSignal[] = [];
    const inner = new Scripted(clock, () => ({ fail: "server" }));
    const lp = fast(clock, inner, signals);

    for (let i = 0; i < 5; i++) await settle(lp.decide(prompt()));
    expect(lp.status().circuit).toBe("open");
    expect(inner.starts.length).toBe(5);

    const blocked = (await settle(lp.decide(prompt()))) as { error: CircuitOpenError };
    expect(blocked.error).toBeInstanceOf(CircuitOpenError);
    expect(blocked.error.kind).toBe("server");
    expect(blocked.error.retryAfterMs).toBe(60_000);
    expect(inner.starts.length).toBe(5); // no call reached the API

    await clock.advance(59_999);
    expect(lp.status().circuit).toBe("open");
    await clock.advance(1);
    expect(lp.status().circuit).toBe("half_open");

    inner.setScript(() => "ok");
    expect("value" in (await settle(lp.decide(prompt())))).toBe(true);
    expect(lp.status().circuit).toBe("closed");
    expect(signals.filter((s) => s.type === "circuit").map((s) => (s as { state: string }).state)).toEqual(["open", "half_open", "closed"]);
  });

  it("lets only one probe through, and opens again when it fails", async () => {
    const clock = new ManualClock();
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const inner: Provider = {
      name: "flaky",
      decide: async () => {
        if (++calls > 5) await gate; // the probe hangs until released
        throw new ProviderError("server", "down");
      },
    };
    const lp = fast(clock, inner, []);
    for (let i = 0; i < 5; i++) await settle(lp.decide(prompt()));
    await clock.advance(60_000);
    expect(lp.status().circuit).toBe("half_open");

    const probe = settle(lp.decide(prompt()));
    await clock.advance(0);
    const second = (await settle(lp.decide(prompt()))) as { error: unknown };
    expect(second.error).toBeInstanceOf(CircuitOpenError);
    expect(calls).toBe(6); // the second caller never reached the API

    release();
    expect(((await probe) as { error: ProviderError }).error.kind).toBe("server");
    expect(lp.status().circuit).toBe("open");
    const again = (await settle(lp.decide(prompt()))) as { error: CircuitOpenError };
    expect(again.error.retryAfterMs).toBe(60_000);
  });

  it("does not count timeouts or 429s toward the run, and a success clears it", async () => {
    const clock = new ManualClock();
    const steps: Step[] = [{ fail: "server" }, { fail: "server" }, { fail: "timeout" }, { fail: "server" }, "ok", { fail: "server" }, { fail: "server" }, { fail: "server" }, { fail: "server" }];
    const inner = new Scripted(clock, (i) => steps[i] ?? "ok");
    const lp = fast(clock, inner, []);
    for (let i = 0; i < 4; i++) await settle(lp.decide(prompt()));
    expect(lp.status().circuit).toBe("closed"); // 3 server errors, not 5
    for (let i = 0; i < 5; i++) await settle(lp.decide(prompt()));
    expect(lp.status().circuit).toBe("closed"); // success reset the run; 4 since then
  });
});

describe("LimitedProvider: outage and auth", () => {
  it("declares an outage after 60 s of failures, pauses, and resumes on the first success", async () => {
    const clock = new ManualClock();
    const signals: LimiterSignal[] = [];
    const inner = new Scripted(clock, () => ({ fail: "timeout" }));
    const lp = createLimitedProvider(inner, { rpmBudget: 600, burst: 20, clock, onSignal: (s) => signals.push(s) });
    await settle(lp.decide(prompt()));
    await clock.advance(59_000);
    await settle(lp.decide(prompt()));
    expect(lp.status().paused).toBe(false);
    await clock.advance(1000);
    expect(lp.status()).toMatchObject({ paused: true, pauseReason: "outage" });
    expect(signals).toContainEqual({ type: "outage", state: "started", sinceMs: 0 });

    inner.setScript(() => "ok"); // retrying continues while paused; the first answer resumes the world
    await lp.decide(prompt());
    expect(lp.status()).toMatchObject({ paused: false, pauseReason: null });
    expect(signals).toContainEqual({ type: "outage", state: "ended", sinceMs: 0 });
  });

  it("does not call a short blip an outage", async () => {
    const clock = new ManualClock();
    const signals: LimiterSignal[] = [];
    const inner = new Scripted(clock, (i) => (i === 0 ? { fail: "network" } : "ok"));
    const lp = createLimitedProvider(inner, { rpmBudget: 600, burst: 20, clock, onSignal: (s) => signals.push(s) });
    await settle(lp.decide(prompt()));
    await lp.decide(prompt());
    await clock.advance(5 * MIN);
    expect(signals).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
  });

  it("treats 429 and unusable answers as proof the API is up", async () => {
    const clock = new ManualClock();
    const inner = new Scripted(clock, (i) => (i === 0 ? { fail: "timeout" } : { fail: "bad_response" }));
    const lp = createLimitedProvider(inner, { rpmBudget: 600, burst: 20, clock });
    await settle(lp.decide(prompt()));
    await settle(lp.decide(prompt()));
    await clock.advance(2 * MIN);
    expect(lp.status().paused).toBe(false);
  });

  it("pauses on a hard auth error, never spins, and resumes when cleared", async () => {
    const clock = new ManualClock();
    const signals: LimiterSignal[] = [];
    const inner = new Scripted(clock, () => ({ fail: "auth" }));
    const lp = createLimitedProvider(inner, { rpmBudget: 600, burst: 20, clock, onSignal: (s) => signals.push(s) });
    expect(((await settle(lp.decide(prompt()))) as { error: ProviderError }).error.kind).toBe("auth");
    expect(lp.status()).toMatchObject({ paused: true, pauseReason: "auth" });
    for (let i = 0; i < 3; i++) expect(((await settle(lp.decide(prompt()))) as { error: ProviderError }).error.kind).toBe("auth");
    expect(inner.starts.length).toBe(1);

    lp.clearAuthFailure();
    inner.setScript(() => "ok");
    await lp.decide(prompt());
    expect(lp.status().paused).toBe(false);
    expect(signals.map((s) => s.type === "auth" && s.state)).toEqual(["failed", "cleared"]);
  });

  it("passes unrelated exceptions through untouched", async () => {
    const clock = new ManualClock();
    const boom = new Error("bug");
    const lp = createLimitedProvider({ name: "x", decide: async () => { throw boom; } }, { rpmBudget: 600, burst: 5, clock });
    expect(((await settle(lp.decide(prompt()))) as { error: unknown }).error).toBe(boom);
  });
});

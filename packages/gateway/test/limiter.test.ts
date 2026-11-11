import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_WAIT_DECISION, FakeProvider, ProviderError, type ProviderErrorKind } from "../src/provider";
import {
  CircuitOpenError, GatewayLimiter, LimitedProvider, ManualClock, RateGovernor, TokenBucket, adaptiveBeatSeconds, backoffDelayMs,
  type StatusChange,
} from "../src/limiter";

// No network in CI: any accidental use of the real fetch fails the test.
let realFetch: typeof fetch;
beforeEach(() => { realFetch = globalThis.fetch; globalThis.fetch = (() => { throw new Error("network is not allowed in tests"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Advance the manual clock in small steps until the promise settles. */
async function drive<T>(clock: ManualClock, promise: Promise<T>, stepMs = 500, maxSteps = 10_000): Promise<Outcome<T>> {
  let outcome: Outcome<T> | undefined;
  promise.then((value) => { outcome = { ok: true, value }; }, (error) => { outcome = { ok: false, error }; });
  for (let i = 0; i < maxSteps && !outcome; i++) await clock.advance(stepMs);
  if (!outcome) throw new Error("promise did not settle");
  return outcome;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const failWith = (kind: ProviderErrorKind, details: { status?: number; retryAfterMs?: number } = {}) => async (): Promise<never> => {
  throw new ProviderError(kind, `scripted ${kind}`, details);
};

function makeLimiter(clock: ManualClock, extra: Partial<ConstructorParameters<typeof GatewayLimiter>[0]> = {}) {
  return new GatewayLimiter({ rpmBudget: 30, clock, rng: () => 0, ...extra });
}

describe("TokenBucket", () => {
  it("spaces calls evenly at the configured rate, first come first served", async () => {
    const clock = new ManualClock();
    const bucket = new TokenBucket({ clock, ratePerMin: () => 30 });
    const times: number[] = [];
    for (let i = 0; i < 5; i++) void bucket.acquire().then(() => times.push(clock.now()));
    await clock.advance(10_000);
    expect(times).toEqual([0, 2000, 4000, 6000, 8000]);
  });

  it("never lets more than the rate through in any 60 s window", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const stamps: number[] = [];
    const calls = Array.from({ length: 200 }, () => limiter.run(async () => { stamps.push(clock.now()); }));
    await clock.advance(420_000);
    await Promise.all(calls);
    expect(stamps).toHaveLength(200);
    for (const start of stamps) {
      const inWindow = stamps.filter((t) => t >= start && t < start + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(30);
    }
  });

  it("drops a cancelled waiter without spending a token", async () => {
    const clock = new ManualClock();
    const bucket = new TokenBucket({ clock, ratePerMin: () => 30 });
    const controller = new AbortController();
    const times: Record<string, number> = {};
    void bucket.acquire().then(() => { times.a = clock.now(); });
    const b = bucket.acquire(controller.signal);
    const bOutcome = b.then(() => "served", (e: ProviderError) => e.kind);
    void bucket.acquire().then(() => { times.c = clock.now(); });
    controller.abort();
    await clock.advance(5000);
    expect(await bOutcome).toBe("aborted");
    expect(times).toEqual({ a: 0, c: 2000 });
    expect(bucket.waiting).toBe(0);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const bucket = new TokenBucket({ clock: new ManualClock(), ratePerMin: () => 30 });
    const controller = new AbortController();
    controller.abort();
    await expect(bucket.acquire(controller.signal)).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("adaptive beat length", () => {
  it("is the larger of the configured beat and calls_needed / rpm_budget", () => {
    expect(adaptiveBeatSeconds(6, 4, 30)).toBe(8);
    expect(adaptiveBeatSeconds(6, 2, 30)).toBe(6);
    expect(adaptiveBeatSeconds(6, 0, 30)).toBe(6);
    expect(adaptiveBeatSeconds(6, 4, 24)).toBe(10);
  });

  it("rejects a non-positive rate", () => {
    expect(() => adaptiveBeatSeconds(6, 4, 0)).toThrow(RangeError);
  });
});

describe("backoffDelayMs", () => {
  it("doubles with each attempt and jitters between half and the full delay", () => {
    expect(backoffDelayMs(0, { rng: () => 0 })).toBe(500);
    expect(backoffDelayMs(0, { rng: () => 0.999999 })).toBe(1000);
    expect(backoffDelayMs(3, { rng: () => 0 })).toBe(4000);
    expect(backoffDelayMs(3, { rng: () => 0.5 })).toBe(6000);
  });

  it("is capped, and Retry-After is a floor", () => {
    expect(backoffDelayMs(20, { rng: () => 1, maxMs: 60_000 })).toBe(60_000);
    expect(backoffDelayMs(0, { rng: () => 0, retryAfterMs: 15_000 })).toBe(15_000);
    expect(backoffDelayMs(10, { rng: () => 0, maxMs: 8000, retryAfterMs: 1000 })).toBe(4000);
  });
});

describe("RateGovernor", () => {
  it("drops 20 percent on a 429, holds for 5 minutes, then ramps back to the full rate", () => {
    const clock = new ManualClock();
    const governor = new RateGovernor(clock, 30);
    expect(governor.rpm()).toBe(30);
    governor.on429();
    expect(governor.rpm()).toBeCloseTo(24, 6);
    expect(governor.slowed).toBe(true);
    void clock.advance(299_000);
    expect(governor.rpm(299_000)).toBeCloseTo(24, 6);
    expect(governor.rpm(300_000 + 60_000)).toBeCloseTo(27, 6);
    expect(governor.rpm(300_000 + 120_000)).toBeCloseTo(30, 6);
    expect(governor.rpm(10_000_000)).toBe(30);
  });

  it("compounds on repeated 429s but never goes below the floor", () => {
    const governor = new RateGovernor(new ManualClock(), 30);
    governor.on429(0);
    governor.on429(1000);
    expect(governor.rpm(1000)).toBeCloseTo(19.2, 6);
    for (let i = 0; i < 20; i++) governor.on429(2000);
    expect(governor.rpm(2000)).toBeCloseTo(7.5, 6);
  });
});

describe("GatewayLimiter: 429 handling", () => {
  it("holds the limit through an injected 429, slows down 20 percent, then recovers", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const stamps: number[] = [];
    const fake = new FakeProvider({
      fallback: (_prompt, index) => {
        stamps.push(clock.now());
        return index === 2 ? { fail: "rate_limit", status: 429 } : FAKE_WAIT_DECISION;
      },
    });
    const provider = new LimitedProvider(fake, limiter);

    const calls = Array.from({ length: 20 }, (_, i) => provider.decide({ system: "", user: "", mindId: `m${i}` }));
    await clock.advance(120_000);
    const settled = await Promise.allSettled(calls);

    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    expect(stamps).toHaveLength(21); // 20 calls plus the one retry
    expect(limiter.stats.rateLimited).toBe(1);
    expect(limiter.stats.retried).toBe(1);
    // before the 429: the full rate (2 s apart at 30 per minute)
    expect(stamps[1]! - stamps[0]!).toBe(2000);
    expect(stamps[2]! - stamps[1]!).toBe(2000);
    // after it: never closer than 2.5 s, which is 24 per minute
    for (let i = 3; i < stamps.length; i++) expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(2500);
    expect(limiter.currentRpm).toBeCloseTo(24, 6);
    expect(limiter.slowed).toBe(true);

    // 5 minute hold from the 429, then the ramp, then the full rate
    await clock.advance(4000 + 300_000 + 120_000 - clock.now() + 1000);
    expect(limiter.currentRpm).toBeCloseTo(30, 6);
    expect(limiter.slowed).toBe(false);
  });

  it("makes every caller wait out the backoff, and treats Retry-After as a floor", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const stamps: number[] = [];
    let first = true;
    const call = async () => {
      stamps.push(clock.now());
      if (first) { first = false; throw new ProviderError("rate_limit", "slow down", { status: 429, retryAfterMs: 20_000 }); }
    };
    const calls = [limiter.run(call), limiter.run(call), limiter.run(call)];
    await clock.advance(60_000);
    await Promise.all(calls);
    expect(stamps).toHaveLength(4);
    // the second and third callers were queued behind the refused one, so they also wait 20 s
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(20_000);
    expect(stamps[2]! - stamps[1]!).toBeGreaterThanOrEqual(2500);
  });

  it("gives up after the retry limit and returns the 429 to the caller", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock, { backoff: { maxRetries: 2 } });
    let calls = 0;
    const outcome = await drive(clock, limiter.run(async () => { calls++; throw new ProviderError("rate_limit", "no", { status: 429 }); }));
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: ProviderError }).error.kind).toBe("rate_limit");
    expect(calls).toBe(3);
  });

  it("does not retry a 429 that would land after the call's deadline", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    let calls = 0;
    const outcome = await drive(clock, limiter.run(async () => { calls++; throw new ProviderError("rate_limit", "no", { status: 429, retryAfterMs: 30_000 }); }, { deadlineAt: clock.now() + 25_000 }));
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("stretches the adaptive beat while the rate is lowered", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock, { backoff: { maxRetries: 0 } }); // one 429, no retries
    expect(limiter.beatSeconds(6, 4)).toBe(8);
    await drive(clock, limiter.run(failWith("rate_limit", { status: 429 })).catch(() => undefined));
    expect(limiter.beatSeconds(6, 4)).toBeCloseTo(10, 6);
  });
});

describe("GatewayLimiter: timeouts, 5xx and the circuit breaker", () => {
  it("returns a timeout to the caller without retrying it or opening the circuit", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    let calls = 0;
    const outcome = await drive(clock, limiter.run(async () => { calls++; throw new ProviderError("timeout", "slow"); }));
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(1);
    expect(limiter.breakerState).toBe("closed");
  });

  it("opens after 5 server errors in a row and then refuses calls without sending them", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    let sent = 0;
    const server = async () => { sent++; throw new ProviderError("server", "boom", { status: 503 }); };
    for (let i = 0; i < 5; i++) await drive(clock, limiter.run(server));
    expect(limiter.breakerState).toBe("open");
    expect(sent).toBe(5);

    const refused = await drive(clock, limiter.run(server), 1);
    expect(refused.ok).toBe(false);
    expect((refused as { error: unknown }).error).toBeInstanceOf(CircuitOpenError);
    expect(sent).toBe(5);
    expect(limiter.stats.refusedByBreaker).toBe(1);
  });

  it("a success resets the streak, so only consecutive 5xx count", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const server = failWith("server", { status: 500 });
    for (let i = 0; i < 4; i++) await drive(clock, limiter.run(server));
    await drive(clock, limiter.run(async () => "ok"));
    for (let i = 0; i < 4; i++) await drive(clock, limiter.run(server));
    expect(limiter.breakerState).toBe("closed");
  });

  it("lets one probe through after 60 s and closes again when it succeeds", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    for (let i = 0; i < 5; i++) await drive(clock, limiter.run(failWith("server", { status: 502 })));
    expect(limiter.breakerState).toBe("open");

    await clock.advance(60_000);
    const probe = await drive(clock, limiter.run(async () => "recovered"));
    expect(probe).toEqual({ ok: true, value: "recovered" });
    expect(limiter.breakerState).toBe("closed");
    const next = await drive(clock, limiter.run(async () => "normal"));
    expect(next).toEqual({ ok: true, value: "normal" });
  });

  it("re-opens for another 60 s when the probe fails", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    for (let i = 0; i < 5; i++) await drive(clock, limiter.run(failWith("server", { status: 500 })));
    await clock.advance(60_000);
    const probe = await drive(clock, limiter.run(failWith("server", { status: 500 })));
    expect(probe.ok).toBe(false);
    expect(limiter.breakerState).toBe("open");
    const refused = await drive(clock, limiter.run(async () => "x"), 1);
    expect((refused as { error: unknown }).error).toBeInstanceOf(CircuitOpenError);
    await clock.advance(60_000);
    expect(await drive(clock, limiter.run(async () => "back"))).toEqual({ ok: true, value: "back" });
  });

  it("allows only one probe at a time", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    for (let i = 0; i < 5; i++) await drive(clock, limiter.run(failWith("server", { status: 500 })));
    await clock.advance(60_000);

    const gate = deferred<string>();
    const probe = limiter.run(() => gate.promise);
    await clock.advance(0);
    const second = limiter.run(async () => "second");
    const secondOutcome = drive(clock, second, 500, 20);
    expect((await secondOutcome).ok).toBe(false);
    expect(((await secondOutcome) as { error: unknown }).error).toBeInstanceOf(CircuitOpenError);

    gate.resolve("probe done");
    expect(await probe).toBe("probe done");
    expect(limiter.breakerState).toBe("closed");
  });

  it("a 429 shows the API is up, so it closes a half-open circuit", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock, { backoff: { maxRetries: 0 } });
    for (let i = 0; i < 5; i++) await drive(clock, limiter.run(failWith("server", { status: 500 })));
    await clock.advance(60_000);
    await drive(clock, limiter.run(failWith("rate_limit", { status: 429 })));
    expect(limiter.breakerState).toBe("closed");
  });
});

describe("GatewayLimiter: outage and auth signals", () => {
  function track(limiter: GatewayLimiter): StatusChange[] {
    const changes: StatusChange[] = [];
    limiter.onStatus((c) => changes.push(c));
    return changes;
  }

  it("signals an outage after 60 s of continuous failure and auto-resumes on the first success", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const changes = track(limiter);

    for (let i = 0; i < 40 && limiter.status === "ok"; i++) await drive(clock, limiter.run(failWith("timeout")));
    expect(limiter.status).toBe("outage");
    expect(changes).toHaveLength(1);
    expect(changes[0]!.status).toBe("outage");
    expect(changes[0]!.at).toBeGreaterThanOrEqual(60_000);
    expect(limiter.breakerState).toBe("closed"); // timeouts alone keep retrying

    expect(await drive(clock, limiter.run(async () => "up"))).toEqual({ ok: true, value: "up" });
    expect(limiter.status).toBe("ok");
    expect(changes.map((c) => c.status)).toEqual(["outage", "ok"]);
  });

  it("detects an outage while the circuit is open and no calls are going out", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const changes = track(limiter);
    for (let i = 0; i < 5; i++) await drive(clock, limiter.run(failWith("server", { status: 503 })));
    expect(limiter.status).toBe("ok");

    await clock.advance(55_000); // now 63 s past the first failure, circuit still open until 68 s
    await drive(clock, limiter.run(async () => "x"), 1);
    expect(limiter.status).toBe("outage");

    await clock.advance(10_000);
    expect(await drive(clock, limiter.run(async () => "back"))).toEqual({ ok: true, value: "back" });
    expect(changes.map((c) => c.status)).toEqual(["outage", "ok"]);
  });

  it("a 429 or a malformed reply is not an outage and clears the failure streak", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock, { backoff: { maxRetries: 0 } });
    for (let i = 0; i < 20; i++) await drive(clock, limiter.run(failWith("timeout")));
    await drive(clock, limiter.run(failWith("bad_response")));
    for (let i = 0; i < 20; i++) await drive(clock, limiter.run(failWith("timeout")));
    expect(limiter.status).toBe("ok");
  });

  it("pauses on an auth error, refuses calls without sending them, and resumes on request", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const changes = track(limiter);
    let sent = 0;
    const auth = async () => { sent++; throw new ProviderError("auth", "key rejected", { status: 401 }); };

    const first = await drive(clock, limiter.run(auth));
    expect((first as { error: ProviderError }).error.kind).toBe("auth");
    expect(limiter.status).toBe("auth");

    const second = await drive(clock, limiter.run(auth), 1);
    expect((second as { error: ProviderError }).error.kind).toBe("auth");
    expect(sent).toBe(1);

    limiter.resume();
    expect(limiter.status).toBe("ok");
    expect(await drive(clock, limiter.run(async () => "fixed"))).toEqual({ ok: true, value: "fixed" });
    expect(changes.map((c) => c.status)).toEqual(["auth", "ok"]);
  });

  it("stops notifying a listener that unsubscribed", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const seen: GatewayStatus[] = [];
    const stop = limiter.onStatus((c) => seen.push(c.status));
    stop();
    await drive(clock, limiter.run(failWith("auth")));
    expect(seen).toEqual([]);
  });
});

type GatewayStatus = GatewayLimiter["status"];

describe("LimitedProvider", () => {
  it("passes replies through and counts them", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const fake = new FakeProvider({ queue: ["one", "two"] });
    const provider = new LimitedProvider(fake, limiter);
    expect(provider.name).toBe("fake");
    const a = provider.decide({ system: "", user: "" });
    const b = provider.decide({ system: "", user: "" });
    await clock.advance(5000);
    expect((await a).text).toBe("one");
    expect((await b).text).toBe("two");
    expect(limiter.stats.succeeded).toBe(2);
  });

  it("a call cancelled while waiting for a slot never reaches the provider", async () => {
    const clock = new ManualClock();
    const limiter = makeLimiter(clock);
    const fake = new FakeProvider();
    const provider = new LimitedProvider(fake, limiter);
    const controller = new AbortController();
    const first = provider.decide({ system: "", user: "" });
    const late = provider.decide({ system: "", user: "", signal: controller.signal });
    const lateOutcome = late.then(() => "served", (e: ProviderError) => e.kind);
    controller.abort();
    await clock.advance(5000);
    await first;
    expect(await lateOutcome).toBe("aborted");
    expect(fake.callCount).toBe(1);
  });
});

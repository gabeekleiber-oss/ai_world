# Limiter (GW-02)

Pacing and failure handling for every model call (DESIGN.md section 10, failure table). One `GatewayLimiter` is shared by all minds, so the rate limit holds for the whole gateway.

```ts
const limiter = new GatewayLimiter({ rpmBudget: config.llm.rpm_budget });
const provider = new LimitedProvider(innerProvider, limiter); // drop-in Provider
limiter.onStatus((change) => { /* pause or resume the world clock, show a banner */ });
const beatSeconds = limiter.beatSeconds(config.time.beat_seconds, callsNeeded);
```

## Behaviour

| Situation | What happens |
|-----------|--------------|
| Normal | Token bucket, first come first served, burst 1: calls are spaced `60 / rpm` seconds apart. A call whose signal aborts while waiting leaves the queue without using a slot. |
| 429 | Exponential backoff with jitter (Retry-After is a floor). Every caller waits it out. The rate drops 20 percent for 5 minutes, then ramps back over 2 minutes. Further 429s compound, down to 25 percent of the budget. The call is retried up to 3 times, and not past its own deadline. |
| Timeout, network error | Thrown to the caller (the mind stands still this beat). Not retried here. |
| 5xx | Same. Five in a row open the circuit for 60 s: calls are refused at once with `CircuitOpenError` and never sent. Then one probe goes out; success closes the circuit, failure re-opens it. |
| Over 60 s of continuous timeouts, network errors or 5xx | `status` becomes `"outage"` (pause the world clock). The first successful call sets it back to `"ok"`. A 429 or an unparseable reply counts as the API being up. |
| Auth error | `status` becomes `"auth"`. Calls are refused without being sent until `resume()`. |

`adaptiveBeatSeconds(configured, callsNeeded, rpm)` is `max(configured, calls / rpm * 60)`. `limiter.beatSeconds` uses the rate allowed right now, so a slowdown stretches the beat too.

## Testing

`ManualClock` replaces real time: `await clock.advance(ms)` fires timers in order and lets awaiting code run. Pass it as `clock`, and `rng: () => 0` for fixed jitter. Tests: `packages/gateway/test/limiter.test.ts`.

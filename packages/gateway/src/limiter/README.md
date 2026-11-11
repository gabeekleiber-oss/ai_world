# Limiter (GW-02)

Rate limiting and failure policy from DESIGN.md section 10. `createLimitedProvider(provider, { rpmBudget })` wraps any `Provider`; the scheduler (GW-06) uses the wrapper and reads `status()`, `beatSeconds()` and `onSignal()`.

| Piece | Behaviour |
|-------|-----------|
| `TokenBucket` | FIFO, evenly spaced (burst 1 by default), rate can change while callers wait. Any half-open 60 s window holds at most `rpm_budget` call starts. |
| 429 | Backoff `ceiling/2 + random * ceiling/2` (base 1 s, cap 30 s, doubling), Retry-After is a floor, up to 3 retries, then the error goes to the caller. Each 429 drops the rate 20 percent for 5 minutes, then it climbs back in 4 steps of 30 s. Repeated 429s restart the hold and do not compound. |
| timeout, network | Thrown as is. No retry here: the mind stands still this beat. |
| 5xx | Thrown as is. Five in a row open the circuit for 60 s: calls fail at once with `CircuitOpenError` (kind `server`, `retryAfterMs`). Then one probe is let through: success closes, a 5xx re-opens. Only a success resets the run. |
| outage | No success for 60 s of timeouts, network errors or 5xx: `status().paused` is true (`pauseReason: "outage"`) until a call gets an answer. A 429 or an unusable answer counts as an answer. |
| auth | `paused` with `pauseReason: "auth"`. Later calls fail at once, no spinning, until `clearAuthFailure()`. |
| beat length | `adaptiveBeatSeconds` is `max(configured, calls / rpm * 60)`. `beatSeconds()` uses the rate now in force, so beats stretch further during a slowdown. |

Signals (`onSignal`): `throttle` (log as `api_throttle`), `circuit`, `outage` (log as `api_outage`, banner), `auth`.

Not here: a 429 reported only through a rate-limit header on a successful answer. The provider does not expose headers on success, so that case needs a provider change.

Tests use `ManualClock`, which moves only when `advance` is called, so nothing waits in real time.

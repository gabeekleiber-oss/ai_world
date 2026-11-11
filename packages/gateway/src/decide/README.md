# Decision pipeline (GW-04)

Turns one raw model answer into a decision the engine can act on, following DESIGN.md section 8 (validation pipeline) and section 9 (meta-leak handling). The engine stays authoritative (R4): this layer decides only whether an answer is usable, never what it means.

```ts
const decider = createDecider({ provider, config, lint, reaskMessage, onAttempt });
const result = await decider.decide({ system, user, mindId, signal });
// result.status: "accepted" | "stood_still"; result.decision is always safe to hand to the engine
```

`reaskMessage` is `format_failure` from `config/inhabitant-text.json`. `lint` comes from `loadLint(root)` in `@ai-world/shared/node`.

## What it does

1. Parse with the shared `extractJsonObject` (code fences and trailing text are tolerated).
2. Validate with the shared decision schema.
3. Scan `say` and the free text of the chosen act (label, mark text, leaf entry, leaf search) for meta-category words. `thought` is scanned too, but is exempt and only flagged.
4. Apply the hard caps with the shared `capDecision` (control characters removed, over-length text cut). Each cut is returned in `truncations`.

## When it asks again

One neutral re-ask, then stand still. Triggers: no JSON object, JSON that does not fit the schema, or a meta-category word in what the agent said or did (when `language.reask_on_meta_leak` is true).

- The re-ask prompt is the original prompt plus the neutral line. It does not contain the earlier answer or its thought (R5), and it never names the problem, so it cannot plant a concept.
- Provider failures (timeout, network, server, auth, rate limit) are not format failures. No re-ask: the agent stands still for the beat and the limiter and scheduler (GW-02, GW-06) take over.
- No re-ask once the caller's `signal` has aborted.
- With `reask_on_meta_leak` false, a leak is flagged (`flagged_only`) and the answer goes through unchanged.

## No silent rewriting (R9)

A failed answer is never repaired. A stand-still result carries a plain one-beat `wait`, and the failed answer is used for nothing. Every provider call is reported through `onAttempt` with the full prompt, the raw output, the finish reason and the verdict. `outputCut` is true when the model ran out of tokens. The callback is awaited and its errors are not swallowed, so a log write that fails stops the decision instead of losing the record.

## Event payloads

`decisionFailedPayload(result)` and `metaLeakPayloads(result)` return objects that already match the `decision_failed` and `meta_leak` payloads in `packages/shared`. Private thoughts never appear in them (R5); the caller sends `result.decision.thought` to the owner's thought log only.

## Not in this layer

Handle resolution and feasibility (validation steps 3 to 5), rate limiting and backoff (GW-02), prompt building (GW-03) and the beat scheduler (GW-06).

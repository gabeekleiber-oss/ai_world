import { assertClean, buildDecisionSchema, type CompiledLint, type Config, type Decision, type PayloadOf, type Truncation } from "@ai-world/shared";
import { isProviderError, type Provider } from "../provider/types";
import { interpretResponse, type InterpretContext } from "./interpret";
import type {
  AttemptRecord, DecideInput, DecideResult, FailureReason, MetaLeak, MetaLeakOutcome, RawMetaLeak,
} from "./types";

/** What a mind does when its answer cannot be used: stand still for one beat. */
export function standStillDecision(): Decision {
  return { thought: "", say: null, do: { act: "wait", beats: 1 } };
}

export interface DeciderOptions {
  provider: Provider;
  config: Pick<Config, "movement" | "actions" | "marks" | "priest" | "language">;
  lint: CompiledLint;
  /**
   * The neutral line added to the prompt on the one re-ask, from `format_failure` in config/inhabitant-text.json.
   * It is checked against the forbidden-word list when the decider is created (R2).
   */
  reaskMessage: string;
  /**
   * Called once per provider call, after it is judged, with the full prompt and raw output (R9). Awaited, so a slow or
   * failing log write holds the decision back instead of being lost. An error thrown here is not swallowed.
   */
  onAttempt?: (record: AttemptRecord) => void | Promise<void>;
}

export interface Decider {
  decide(input: DecideInput): Promise<DecideResult>;
}

interface Judged {
  record: AttemptRecord;
  /** Set when the answer is usable. */
  accepted?: { decision: Decision; truncations: Truncation[] };
  /** Set when the answer failed in a way a re-ask can fix. */
  retryable: boolean;
}

/**
 * Per-decision pipeline (DESIGN.md section 8, steps 1, 2, 6 and 7, and section 9 meta-leak handling).
 *
 * - A format failure (no JSON object, or JSON that does not fit the schema) or a meta-category word in what the agent
 *   said or did gets exactly one neutral re-ask. The re-ask is the original prompt plus the neutral line. It carries
 *   neither the earlier answer nor its thought (R5), and never says what was wrong, so it cannot plant a concept.
 * - A second failure means the agent stands still for the beat.
 * - A provider failure (timeout, network, server, auth, rate limit) is not a format failure: there is no re-ask here.
 *   The agent stands still and the scheduler and limiter (GW-02, GW-06) decide what to do next.
 * - `thought` may contain meta-category words. It is flagged and never causes a failure.
 * - Nothing the agent said is repaired or rewritten (R9). Only control characters and over-length text change, and
 *   each truncation is reported.
 */
export function createDecider(options: DeciderOptions): Decider {
  const { provider, config, lint, reaskMessage, onAttempt } = options;
  assertClean(reaskMessage, lint, "re-ask message");
  const ctx: InterpretContext = { schema: buildDecisionSchema(config), lint, caps: config };

  async function judge(attempt: 1 | 2, input: DecideInput): Promise<Judged> {
    const purpose = attempt === 1 ? "decision" : "reask";
    const sent = { ...input, purpose } as const;
    const base = { attempt, purpose, system: sent.system, user: sent.user, ...(input.mindId !== undefined ? { mindId: input.mindId } : {}) } as const;

    let response;
    try {
      response = await provider.decide(sent);
    } catch (error) {
      if (!isProviderError(error)) throw error; // a bug in a provider is not a failed answer; do not hide it
      const reason: FailureReason = error.kind === "timeout" ? "timeout" : "provider_error";
      const record: AttemptRecord = {
        ...base, raw: null, outputCut: false, verdict: reason, detail: `${error.kind}: ${error.message}`, truncations: [], metaLeaks: [],
        providerError: { kind: error.kind, ...(error.status !== undefined ? { status: error.status } : {}), message: error.message },
      };
      await onAttempt?.(record);
      return { record, retryable: false };
    }

    const outputCut = response.finishReason === "length";
    // Decided once, here, so the log and the pipeline can never disagree about whether a re-ask was sent.
    const canReask = attempt === 1 && !input.signal?.aborted;
    const withResponse = {
      ...base, raw: response.text, outputCut, latencyMs: response.latencyMs,
      ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
      ...(response.usage !== undefined ? { usage: response.usage } : {}),
    } as const;

    const result = interpretResponse(response.text, ctx, { outputCut });
    if (!result.ok) {
      const record: AttemptRecord = { ...withResponse, verdict: result.reason, detail: result.detail, truncations: [], metaLeaks: [] };
      await onAttempt?.(record);
      return { record, retryable: canReask };
    }

    const blocking = result.leaks.length > 0 && config.language.reask_on_meta_leak;
    const blockedOutcome: MetaLeakOutcome = canReask ? "reasked" : "stood_still";
    const tag = (leaks: RawMetaLeak[], outcome: MetaLeakOutcome): MetaLeak[] => leaks.map((l) => ({ ...l, outcome }));
    const metaLeaks = [...tag(result.leaks, blocking ? blockedOutcome : "flagged_only"), ...tag(result.thoughtLeaks, "flagged_only")];

    if (blocking) {
      const words = [...new Set(result.leaks.map((l) => l.word))].join(", ");
      const record: AttemptRecord = { ...withResponse, verdict: "meta_leak", detail: `meta-category word in ${[...new Set(result.leaks.map((l) => l.path))].join(", ")}: ${words}`, truncations: [], metaLeaks };
      await onAttempt?.(record);
      return { record, retryable: canReask };
    }

    const record: AttemptRecord = { ...withResponse, verdict: "accepted", truncations: result.truncations, metaLeaks };
    await onAttempt?.(record);
    return { record, accepted: { decision: result.decision, truncations: result.truncations }, retryable: false };
  }

  return {
    async decide(input: DecideInput): Promise<DecideResult> {
      const attempts: AttemptRecord[] = [];
      const first = await judge(1, input);
      attempts.push(first.record);
      if (first.accepted) return { status: "accepted", decision: first.accepted.decision, truncations: first.accepted.truncations, attempts, reasked: false };

      const stoodStill = (last: AttemptRecord, reasked: boolean): DecideResult => ({
        status: "stood_still", decision: standStillDecision(), reason: last.verdict as FailureReason, detail: last.detail ?? last.verdict, attempts, reasked,
      });

      // No re-ask for provider failures, and none once the caller has cancelled this beat.
      if (!first.retryable) return stoodStill(first.record, false);

      const second = await judge(2, { ...input, user: `${input.user}\n\n${reaskMessage}` });
      attempts.push(second.record);
      if (second.accepted) return { status: "accepted", decision: second.accepted.decision, truncations: second.accepted.truncations, attempts, reasked: true };
      return stoodStill(second.record, true);
    },
  };
}

/** The `decision_failed` event payload for a result, or `undefined` when the decision was accepted. */
export function decisionFailedPayload(result: DecideResult): PayloadOf<"decision_failed"> | undefined {
  if (result.status !== "stood_still") return undefined;
  return { reason: result.reason, detail: result.detail, reasked: result.reasked };
}

/** One `meta_leak` event payload per word found, across every attempt. `thought` entries are always `flagged_only`. */
export function metaLeakPayloads(result: DecideResult): PayloadOf<"meta_leak">[] {
  return result.attempts.flatMap((a) => a.metaLeaks.map((l) => ({ field: l.field, word: l.word, outcome: l.outcome })));
}

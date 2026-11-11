import type { Decision, PayloadOf, Truncation } from "@ai-world/shared";
import type { ProviderErrorKind, ProviderPrompt, ProviderUsage } from "../provider/types";

/**
 * Decision pipeline types (DESIGN.md sections 8 and 9). Failure reasons and leak outcomes are chosen to match the
 * `decision_failed` and `meta_leak` event payloads in packages/shared, so the caller can emit events without translating.
 */

/** Where in the answer a meta-category word was found. Matches the `meta_leak` payload's `field`. */
export type MetaField = PayloadOf<"meta_leak">["field"];

/** What happened because of a leak. `flagged_only` covers `thought` (always exempt) and the case where re-asking is switched off. */
export type MetaLeakOutcome = PayloadOf<"meta_leak">["outcome"];

export interface RawMetaLeak {
  field: MetaField;
  /** Location inside the decision object, for the owner's log, for example `say.text`. */
  path: string;
  /** The forbidden word from the list. */
  word: string;
  /** The text as the agent wrote it. */
  matched: string;
  category: string;
}

export interface MetaLeak extends RawMetaLeak {
  outcome: MetaLeakOutcome;
}

/** Why a beat ended with the agent standing still. A subset of the `decision_failed` payload's `reason`. */
export type FailureReason = "unparseable" | "schema" | "meta_leak" | "timeout" | "provider_error";

/** One call to the provider and what the pipeline made of it. Written for the owner; never shown to any agent (R5, R9). */
export interface AttemptRecord {
  /** 1 for the first ask, 2 for the single neutral re-ask. */
  attempt: 1 | 2;
  purpose: "decision" | "reask";
  mindId?: string;
  /** The full prompt that was sent (R9). */
  system: string;
  user: string;
  /** The raw model output, exactly as received. `null` when the provider call itself failed. */
  raw: string | null;
  finishReason?: string;
  usage?: ProviderUsage;
  latencyMs?: number;
  /** True when the model stopped because it ran out of tokens, so the answer may be cut off. */
  outputCut: boolean;
  providerError?: { kind: ProviderErrorKind; status?: number; message: string };
  verdict: "accepted" | FailureReason;
  /** Short explanation for the log. Owner-only. */
  detail?: string;
  /** Length truncations applied to the accepted answer (section 8 step 7). Empty unless the answer was accepted. */
  truncations: Truncation[];
  /** Every meta-category word found in this answer, including the exempt `thought` field. */
  metaLeaks: MetaLeak[];
}

export interface DecideResultBase {
  /** Every provider call made for this decision, in order. At most two. */
  attempts: AttemptRecord[];
  /** True when a neutral re-ask was sent. */
  reasked: boolean;
}

export interface DecideAccepted extends DecideResultBase {
  status: "accepted";
  /** The agent's answer, with only the hard caps applied (R9). */
  decision: Decision;
  /** Length truncations applied to `decision`. Log every one. */
  truncations: Truncation[];
}

export interface DecideStoodStill extends DecideResultBase {
  status: "stood_still";
  /** A plain one-beat wait. The agent's failed answer is not used for anything. */
  decision: Decision;
  reason: FailureReason;
  detail: string;
}

export type DecideResult = DecideAccepted | DecideStoodStill;

export type DecideInput = Omit<ProviderPrompt, "purpose">;

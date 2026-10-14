/**
 * Provider interface (DESIGN.md section 10). The gateway talks to a model only through this
 * boundary, so another provider, a local model or the offline fake can replace the NVIDIA
 * adapter without touching the rest of the system.
 */

export type CallPurpose = "decision" | "reask" | "compaction";

export interface ProviderPrompt {
  /** Fixed system layer. */
  system: string;
  /** Memory block plus percept, already assembled and lint-checked by the caller. */
  user: string;
  /** Which mind this call is for. Used only for logging and fake-provider scripting. */
  mindId?: string;
  purpose?: CallPurpose;
  /** Per-call overrides of the configured sampling parameters. */
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** Per-call timeout override in milliseconds. */
  timeoutMs?: number;
  /** Caller-side cancellation (late responses are discarded by the beat barrier). */
  signal?: AbortSignal;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ProviderResponse {
  text: string;
  usage?: ProviderUsage;
  finishReason?: string;
  latencyMs: number;
}

export interface Provider {
  /** Short stable name for logs, for example "nvidia-nim" or "fake". Never contains secrets. */
  readonly name: string;
  decide(prompt: ProviderPrompt): Promise<ProviderResponse>;
}

/**
 * Failure classes, matching the failure table in DESIGN.md section 10:
 * rate_limit -> back off and slow the limiter; timeout and network -> stand still this beat;
 * server -> same, circuit-open after repeated hits; auth -> pause, never spin;
 * bad_response -> treat like unparseable output; aborted -> caller cancelled.
 */
export type ProviderErrorKind = "rate_limit" | "timeout" | "network" | "server" | "auth" | "bad_response" | "aborted";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Server-suggested wait, from a Retry-After header, in milliseconds. */
  readonly retryAfterMs?: number;

  constructor(kind: ProviderErrorKind, message: string, details: { status?: number; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ProviderError";
    this.kind = kind;
    if (details.status !== undefined) this.status = details.status;
    if (details.retryAfterMs !== undefined) this.retryAfterMs = details.retryAfterMs;
  }

  /** True for failures where trying again later can succeed. Auth errors are never retryable. */
  get retryable(): boolean {
    return this.kind !== "auth" && this.kind !== "aborted";
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}

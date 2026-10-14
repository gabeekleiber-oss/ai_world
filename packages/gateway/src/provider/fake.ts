import { ProviderError, type Provider, type ProviderErrorKind, type ProviderPrompt, type ProviderResponse } from "./types";

/** One scripted outcome: reply text, or a failure of a given kind. */
export type FakeStep =
  | string
  | { text: string; delayMs?: number; usage?: ProviderResponse["usage"]; finishReason?: string }
  | { fail: ProviderErrorKind; status?: number; retryAfterMs?: number; delayMs?: number };

export type FakeScript = FakeStep | ((prompt: ProviderPrompt, callIndex: number) => FakeStep);

export interface FakeProviderOptions {
  /** Used when the queue is empty. Defaults to a safe "wait one beat" decision. */
  fallback?: FakeScript;
  /** Scripted steps consumed in order across all calls. */
  queue?: FakeScript[];
  /** Per-mind queues, consumed before the shared queue. */
  perMind?: Record<string, FakeScript[]>;
  name?: string;
}

/** Canned decision that is valid under the decision schema and always safe for a mind to take. */
export const FAKE_WAIT_DECISION = JSON.stringify({ thought: "", say: null, do: { act: "wait", beats: 1 } });

/**
 * Offline provider for tests, CI and mock-mind runs. Deterministic: it never reads a clock for
 * its output, never touches the network and never uses randomness.
 */
export class FakeProvider implements Provider {
  readonly name: string;
  readonly calls: ProviderPrompt[] = [];
  private readonly queue: FakeScript[];
  private readonly perMind: Map<string, FakeScript[]>;
  private fallback: FakeScript;

  constructor(options: FakeProviderOptions = {}) {
    this.name = options.name ?? "fake";
    this.fallback = options.fallback ?? FAKE_WAIT_DECISION;
    this.queue = [...(options.queue ?? [])];
    this.perMind = new Map(Object.entries(options.perMind ?? {}).map(([k, v]) => [k, [...v]]));
  }

  /** Queue more scripted outcomes. */
  enqueue(...steps: FakeScript[]): this {
    this.queue.push(...steps);
    return this;
  }

  enqueueFor(mindId: string, ...steps: FakeScript[]): this {
    const list = this.perMind.get(mindId) ?? [];
    list.push(...steps);
    this.perMind.set(mindId, list);
    return this;
  }

  setFallback(script: FakeScript): this {
    this.fallback = script;
    return this;
  }

  get callCount(): number {
    return this.calls.length;
  }

  async decide(prompt: ProviderPrompt): Promise<ProviderResponse> {
    const index = this.calls.length;
    this.calls.push({ ...prompt });
    if (prompt.signal?.aborted) throw new ProviderError("aborted", "call cancelled before it started");

    const own = prompt.mindId ? this.perMind.get(prompt.mindId) : undefined;
    const script = own && own.length > 0 ? own.shift()! : this.queue.length > 0 ? this.queue.shift()! : this.fallback;
    const step = typeof script === "function" ? script(prompt, index) : script;

    const delayMs = typeof step === "object" && "delayMs" in step ? (step.delayMs ?? 0) : 0;
    if (delayMs > 0) await delay(delayMs, prompt.signal);

    if (typeof step === "object" && "fail" in step) {
      throw new ProviderError(step.fail, `fake provider scripted failure: ${step.fail}`, {
        ...(step.status !== undefined ? { status: step.status } : {}),
        ...(step.retryAfterMs !== undefined ? { retryAfterMs: step.retryAfterMs } : {}),
      });
    }
    const body = typeof step === "string" ? { text: step } : step;
    return {
      text: body.text,
      latencyMs: delayMs,
      ...("usage" in body && body.usage ? { usage: body.usage } : {}),
      ...("finishReason" in body && body.finishReason ? { finishReason: body.finishReason } : {}),
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("aborted", "call cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

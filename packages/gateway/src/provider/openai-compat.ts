import { redactSecrets } from "./redact";
import { ProviderError, type Provider, type ProviderPrompt, type ProviderResponse } from "./types";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<FetchResponseLike>;

/** The slice of the fetch Response used here, so tests can pass a plain object. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface OpenAICompatOptions {
  /** For example https://integrate.api.nvidia.com/v1. Comes from config only. */
  baseUrl: string;
  /** Exact model id. Comes from config only. */
  modelId: string;
  /** Bearer key. Comes from the environment only. Never logged, never serialized. */
  apiKey: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  name?: string;
  /** Injectable for tests. Defaults to the global fetch, resolved at call time. */
  fetchImpl?: FetchLike;
}

/** Adapter for any OpenAI-compatible /chat/completions endpoint, including NVIDIA NIM. */
export class OpenAICompatProvider implements Provider {
  readonly name: string;
  readonly #apiKey: string;
  readonly #options: Omit<OpenAICompatOptions, "apiKey">;

  constructor(options: OpenAICompatOptions) {
    if (!options.apiKey.trim()) throw new ProviderError("auth", "no API key set; put it in .env (see .env.example)");
    if (!options.modelId.trim() || /^CONFIRM_AT_BUILD/i.test(options.modelId)) {
      throw new ProviderError("bad_response", "llm.model_id in config/default.json is still a placeholder; confirm the model id on the NVIDIA account page");
    }
    const { apiKey, ...rest } = options;
    this.#apiKey = apiKey.trim();
    this.#options = { ...rest, baseUrl: options.baseUrl.replace(/\/+$/, "") };
    this.name = options.name ?? "openai-compat";
  }

  /** Never reveals the key, even to JSON.stringify or console.log. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, baseUrl: this.#options.baseUrl, modelId: this.#options.modelId };
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `OpenAICompatProvider(${this.name}, ${this.#options.modelId})`;
  }

  async decide(prompt: ProviderPrompt): Promise<ProviderResponse> {
    const o = this.#options;
    const started = Date.now();
    const timeoutMs = prompt.timeoutMs ?? o.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (prompt.signal?.aborted) controller.abort();
    else prompt.signal?.addEventListener("abort", onCallerAbort, { once: true });

    const body = JSON.stringify({
      model: o.modelId,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: prompt.temperature ?? o.temperature,
      top_p: prompt.topP ?? o.topP,
      max_tokens: prompt.maxTokens ?? o.maxTokens,
      stream: false,
    });

    let response: FetchResponseLike;
    try {
      const doFetch: FetchLike = o.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponseLike>);
      response = await doFetch(`${o.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${this.#apiKey}` },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      prompt.signal?.removeEventListener("abort", onCallerAbort);
      if (timedOut) throw new ProviderError("timeout", `no response within ${Math.round(timeoutMs / 1000)} s`);
      if (prompt.signal?.aborted) throw new ProviderError("aborted", "call cancelled");
      throw new ProviderError("network", this.#scrub(`network error: ${errorMessage(error)}`));
    }

    try {
      const raw = await response.text();
      if (!response.ok) throw this.#httpError(response, raw);
      return this.#parse(raw, Date.now() - started);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (timedOut) throw new ProviderError("timeout", `response body not received within ${Math.round(timeoutMs / 1000)} s`);
      if (prompt.signal?.aborted) throw new ProviderError("aborted", "call cancelled");
      throw new ProviderError("network", this.#scrub(`network error: ${errorMessage(error)}`));
    } finally {
      clearTimeout(timer);
      prompt.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  #scrub(text: string): string {
    return redactSecrets(text, this.#apiKey);
  }

  #httpError(response: FetchResponseLike, raw: string): ProviderError {
    const status = response.status;
    const detail = this.#scrub(extractErrorText(raw)).slice(0, 200);
    const suffix = detail ? `: ${detail}` : "";
    if (status === 401 || status === 403) {
      return new ProviderError("auth", `the API rejected the key (HTTP ${status})${suffix}`, { status });
    }
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      return new ProviderError("rate_limit", `rate limited (HTTP 429)${suffix}`, { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
    }
    if (status === 408 || status === 504) return new ProviderError("timeout", `upstream timeout (HTTP ${status})${suffix}`, { status });
    if (status >= 500) return new ProviderError("server", `server error (HTTP ${status})${suffix}`, { status });
    return new ProviderError("bad_response", `unexpected HTTP ${status}${suffix}`, { status });
  }

  #parse(raw: string, latencyMs: number): ProviderResponse {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ProviderError("bad_response", "response was not JSON");
    }
    const root = asRecord(json);
    const choice = asRecord(Array.isArray(root?.choices) ? root.choices[0] : undefined);
    const message = asRecord(choice?.message);
    const content = message?.content;
    if (typeof content !== "string") throw new ProviderError("bad_response", "response had no message content");
    const usage = asRecord(root?.usage);
    const result: ProviderResponse = { text: content, latencyMs };
    if (typeof choice?.finish_reason === "string") result.finishReason = choice.finish_reason;
    if (typeof usage?.prompt_tokens === "number" && typeof usage.completion_tokens === "number") {
      result.usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
    }
    return result;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractErrorText(raw: string): string {
  try {
    const root = asRecord(JSON.parse(raw));
    const err = root?.error;
    if (typeof err === "string") return err;
    const m = asRecord(err)?.message ?? root?.message ?? root?.detail;
    if (typeof m === "string") return m;
  } catch { /* not JSON */ }
  return raw.trim();
}

/** Retry-After is either whole seconds or an HTTP date. Returns milliseconds, or undefined. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { buildDecisionSchema, resolveConfig } from "@ai-world/shared";
import {
  FAKE_WAIT_DECISION, FakeProvider, OpenAICompatProvider, ProviderError, createProvider, parseDotEnv, parseRetryAfter, redactSecrets,
  type FetchLike, type FetchResponseLike,
} from "../src/provider";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KEY = "nvapi-SECRETSECRETSECRET1234";
const root = join(__dirname, "..", "..", "..");
const config = resolveConfig(JSON.parse(readFileSync(join(root, "config", "default.json"), "utf8")));

function reply(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponseLike {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => text };
}
const okBody = (content: string) => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 } });

function adapter(fetchImpl: FetchLike, extra: Partial<ConstructorParameters<typeof OpenAICompatProvider>[0]> = {}) {
  return new OpenAICompatProvider({
    baseUrl: "https://example.test/v1/", modelId: "test-model", apiKey: KEY, temperature: 0.9, topP: 0.8, maxTokens: 123, timeoutMs: 1000, fetchImpl, ...extra,
  });
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try { await promise; } catch (e) { return e as ProviderError; }
  throw new Error("expected rejection");
}

// No network in CI: any accidental use of the real fetch fails the test.
let realFetch: typeof fetch;
beforeEach(() => { realFetch = globalThis.fetch; globalThis.fetch = (() => { throw new Error("network is not allowed in tests"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

describe("FakeProvider", () => {
  it("returns a wait decision that is valid under the decision schema by default", async () => {
    const fake = new FakeProvider();
    const res = await fake.decide({ system: "s", user: "u" });
    expect(res.text).toBe(FAKE_WAIT_DECISION);
    expect(() => buildDecisionSchema(config).parse(JSON.parse(res.text))).not.toThrow();
  });

  it("plays queued text and failures in order, then falls back", async () => {
    const fake = new FakeProvider({ queue: ["one", { text: "two", usage: { promptTokens: 1, completionTokens: 2 } }, { fail: "rate_limit", status: 429, retryAfterMs: 1500 }], fallback: "done" });
    expect((await fake.decide({ system: "", user: "" })).text).toBe("one");
    const two = await fake.decide({ system: "", user: "" });
    expect(two.text).toBe("two");
    expect(two.usage).toEqual({ promptTokens: 1, completionTokens: 2 });
    const err = await rejection(fake.decide({ system: "", user: "" }));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("rate_limit");
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1500);
    expect((await fake.decide({ system: "", user: "" })).text).toBe("done");
    expect(fake.callCount).toBe(4);
  });

  it("scripts each failure kind and marks auth as not retryable", async () => {
    for (const kind of ["timeout", "network", "server", "auth", "bad_response"] as const) {
      const err = await rejection(new FakeProvider({ queue: [{ fail: kind }] }).decide({ system: "", user: "" }));
      expect(err.kind).toBe(kind);
      expect(err.retryable).toBe(kind !== "auth");
    }
  });

  it("uses per-mind queues before the shared queue and supports function scripts", async () => {
    const fake = new FakeProvider({ queue: ["shared"], perMind: { "mind-2": ["only for two"] } });
    fake.enqueueFor("mind-3", (p, i) => `call ${i} for ${p.mindId}`);
    expect((await fake.decide({ system: "", user: "", mindId: "mind-2" })).text).toBe("only for two");
    expect((await fake.decide({ system: "", user: "", mindId: "mind-3" })).text).toBe("call 1 for mind-3");
    expect((await fake.decide({ system: "", user: "", mindId: "mind-2" })).text).toBe("shared");
  });

  it("records the prompts it receives", async () => {
    const fake = new FakeProvider();
    await fake.decide({ system: "sys", user: "usr", mindId: "m1", purpose: "compaction" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ system: "sys", user: "usr", mindId: "m1", purpose: "compaction" });
  });

  it("honours cancellation, including while delayed", async () => {
    const pre = new AbortController(); pre.abort();
    expect((await rejection(new FakeProvider().decide({ system: "", user: "", signal: pre.signal }))).kind).toBe("aborted");
    const mid = new AbortController();
    const pending = new FakeProvider({ queue: [{ text: "late", delayMs: 5000 }] }).decide({ system: "", user: "", signal: mid.signal });
    mid.abort();
    expect((await rejection(pending)).kind).toBe("aborted");
  });

  it("never touches the network", async () => {
    await new FakeProvider().decide({ system: "", user: "" });
    expect(createProvider({ ...config.llm, provider: "fake" }).name).toBe("fake");
  });
});

describe("OpenAICompatProvider (mocked HTTP)", () => {
  it("posts a chat completion with bearer auth and configured parameters", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    const provider = adapter(async (url, init) => { seen.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return reply(200, okBody('{"do":{"act":"rest"}}')); });
    const res = await provider.decide({ system: "SYS", user: "USR" });
    expect(res.text).toBe('{"do":{"act":"rest"}}');
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://example.test/v1/chat/completions");
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.body).toMatchObject({ model: "test-model", temperature: 0.9, top_p: 0.8, max_tokens: 123, stream: false });
    expect(seen[0]!.body.messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "USR" }]);
  });

  it("lets a single call override sampling parameters", async () => {
    let body: any;
    const provider = adapter(async (_u, init) => { body = JSON.parse(init.body); return reply(200, okBody("x")); });
    await provider.decide({ system: "", user: "", temperature: 0.2, topP: 0.5, maxTokens: 50 });
    expect(body).toMatchObject({ temperature: 0.2, top_p: 0.5, max_tokens: 50 });
  });

  it.each([
    [401, "auth"], [403, "auth"], [429, "rate_limit"], [500, "server"], [503, "server"], [504, "timeout"], [408, "timeout"], [400, "bad_response"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const err = await rejection(adapter(async () => reply(status, { error: { message: "nope" } })).decide({ system: "", user: "" }));
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
  });

  it("reads Retry-After on 429, as seconds or as a date", async () => {
    const err = await rejection(adapter(async () => reply(429, "", { "retry-after": "7" })).decide({ system: "", user: "" }));
    expect(err.retryAfterMs).toBe(7000);
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("garbage")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("reports malformed bodies as bad_response", async () => {
    for (const body of ["not json", { choices: [] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: null } }] }]) {
      expect((await rejection(adapter(async () => reply(200, body)).decide({ system: "", user: "" }))).kind).toBe("bad_response");
    }
  });

  it("reports a thrown fetch as a network error", async () => {
    const err = await rejection(adapter(async () => { throw new Error("ECONNRESET"); }).decide({ system: "", user: "" }));
    expect(err.kind).toBe("network");
    expect(err.message).toContain("ECONNRESET");
  });

  it("times out when the server never answers", async () => {
    vi.useFakeTimers();
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const pending = rejection(adapter(hang, { timeoutMs: 25_000 }).decide({ system: "", user: "" }));
    await vi.advanceTimersByTimeAsync(25_001);
    expect((await pending).kind).toBe("timeout");
  });

  it("separates caller cancellation from timeout", async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const ctl = new AbortController();
    const pending = rejection(adapter(hang).decide({ system: "", user: "", signal: ctl.signal }));
    ctl.abort();
    expect((await pending).kind).toBe("aborted");
  });

  it("never leaks the key through errors, JSON, inspection or string conversion", async () => {
    const leaky = adapter(async () => reply(401, { error: { message: `bad key ${KEY} and Bearer ${KEY}` } }));
    const err = await rejection(leaky.decide({ system: "", user: "" }));
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain("SECRETSECRET");
    const net = await rejection(adapter(async () => { throw new Error(`connect failed using ${KEY}`); }).decide({ system: "", user: "" }));
    expect(net.message).not.toContain(KEY);
    for (const text of [JSON.stringify(leaky), inspect(leaky, { depth: 5 }), String(leaky), JSON.stringify(err)]) expect(text).not.toContain(KEY);
  });

  it("refuses to build without a key or with the placeholder model id", () => {
    const fetchImpl: FetchLike = async () => reply(200, okBody(""));
    expect(() => adapter(fetchImpl, { apiKey: "  " })).toThrow(/API key/);
    expect(() => adapter(fetchImpl, { modelId: "CONFIRM_AT_BUILD_NVIDIA_COM" })).toThrow(/placeholder/);
  });

  it("does not use the real fetch when none is injected beyond the guarded global", async () => {
    const err = await rejection(adapter(undefined as unknown as FetchLike).decide({ system: "", user: "" }));
    expect(err.kind).toBe("network");
    expect(err.message).toContain("network is not allowed in tests");
  });
});

describe("createProvider and env parsing", () => {
  const live = { ...config.llm, provider: "nvidia-nim", model_id: "some-model" };

  it("needs the key from the environment and says how to set it", () => {
    expect(() => createProvider(live, { env: {} })).toThrow(/NVIDIA_API_KEY/);
  });

  it("refuses the default placeholder model id so a live run cannot start unconfirmed", () => {
    expect(() => createProvider(config.llm, { env: { NVIDIA_API_KEY: KEY } })).toThrow(/placeholder/);
  });

  it("builds an adapter from config plus env and sends configured values", async () => {
    let url = "";
    const provider = createProvider(live, { env: { NVIDIA_API_KEY: KEY }, fetchImpl: async (u) => { url = u; return reply(200, okBody("hi")); } });
    expect((await provider.decide({ system: "", user: "" })).text).toBe("hi");
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(provider.name).toBe("nvidia-nim");
  });

  it("parses .env text", () => {
    const parsed = parseDotEnv(`# comment\nNVIDIA_API_KEY="abc 123"\nexport OTHER='x'\nPLAIN=value # trailing\n\nBAD LINE\n`);
    expect(parsed).toEqual({ NVIDIA_API_KEY: "abc 123", OTHER: "x", PLAIN: "value" });
  });

  it("redacts exact secrets and key-shaped strings", () => {
    expect(redactSecrets(`token ${KEY} end`, KEY)).toBe("token [redacted] end");
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop")).toContain("[redacted]");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});

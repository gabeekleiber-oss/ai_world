import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { EventPayloadSchemas, buildDecisionSchema, resolveConfig } from "@ai-world/shared";
import { loadLint, readJson } from "@ai-world/shared/node";
import { FakeProvider, ProviderError, type Provider, type ProviderPrompt } from "../src/provider";
import {
  createDecider, decisionFailedPayload, interpretResponse, metaLeakPayloads, standStillDecision,
  type AttemptRecord, type DecideInput, type DecideResult,
} from "../src/decide";

const root = join(__dirname, "..", "..", "..");
const config = resolveConfig(readJson(join(root, "config", "default.json")));
const lint = loadLint(root);
const REASK = (readJson(join(root, "config", "inhabitant-text.json")) as { format_failure: string }).format_failure;
const input: DecideInput = { system: "SYSTEM-LAYER", user: "PERCEPT-BLOCK\nWhat do you do next?", mindId: "mind-1" };

const json = (o: unknown) => JSON.stringify(o);
const waitAnswer = (extra: Record<string, unknown> = {}) => json({ thought: "", say: null, do: { act: "wait", beats: 1 }, ...extra });
const sayAnswer = (text: string, extra: Record<string, unknown> = {}) => json({ thought: "", say: { text, volume: "normal", to: null }, do: { act: "wait", beats: 1 }, ...extra });

function setup(opts: { fake?: FakeProvider; cfg?: typeof config; reask?: string } = {}) {
  const fake = opts.fake ?? new FakeProvider();
  const records: AttemptRecord[] = [];
  const decider = createDecider({ provider: fake, config: opts.cfg ?? config, lint, reaskMessage: opts.reask ?? REASK, onAttempt: (r) => { records.push(r); } });
  return { fake, records, decider };
}

// No network in CI: any accidental use of the real fetch fails the test.
let realFetch: typeof fetch;
beforeEach(() => { realFetch = globalThis.fetch; globalThis.fetch = (() => { throw new Error("network is not allowed in tests"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

describe("parsing", () => {
  it("accepts a plain JSON answer with one call", async () => {
    const { fake, decider } = setup({ fake: new FakeProvider({ queue: [sayAnswer("hello there", { thought: "a quiet thought" })] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.reasked).toBe(false);
    expect(fake.callCount).toBe(1);
    expect(r.decision.say?.text).toBe("hello there");
    expect(r.decision.thought).toBe("a quiet thought");
  });

  it("accepts JSON inside a code fence", async () => {
    const fenced = "```json\n" + sayAnswer("from a fence") + "\n```";
    const { fake, decider } = setup({ fake: new FakeProvider({ queue: [fenced] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.decision.say?.text).toBe("from a fence");
    expect(fake.callCount).toBe(1);
  });

  it("accepts JSON followed or preceded by other text", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: [`Here is my answer:\n${sayAnswer("trailing")}\nHope that helps! {not json`] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.decision.say?.text).toBe("trailing");
  });

  it("applies schema defaults for fields the agent left out", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: [json({ do: { act: "wait" } })] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.decision.do).toEqual({ act: "wait", beats: 1 });
    expect(r.decision.thought).toBe("");
  });
});

describe("truncation is reported", () => {
  it("reports each length cut and changes nothing else", async () => {
    const longSay = "x".repeat(300);
    const longThought = Array.from({ length: 90 }, (_, i) => `w${i}`).join(" ");
    const { decider } = setup({ fake: new FakeProvider({ queue: [sayAnswer(longSay, { thought: longThought })] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    if (r.status !== "accepted") return;
    expect(r.truncations).toEqual([
      { field: "thought", from: 90, to: config.actions.thought_max_words },
      { field: "say.text", from: 300, to: config.actions.say_max_chars },
    ]);
    expect(r.decision.say?.text).toBe(longSay.slice(0, config.actions.say_max_chars));
    expect(r.decision.thought).toBe(longThought.split(" ").slice(0, config.actions.thought_max_words).join(" "));
    // The same truncations are on the attempt record, for the owner's log.
    expect(r.attempts[0]?.truncations).toEqual(r.truncations);
  });

  it("removes control characters and keeps every other character as written", async () => {
    const text = "  Hello,   friend!\tSee\u0001 this\u007f… ünï \u{1F600}  ";
    const { decider } = setup({ fake: new FakeProvider({ queue: [sayAnswer(text)] }) });
    const r = await decider.decide(input);
    expect(r.decision.say?.text).toBe("  Hello,   friend!\tSee this… ünï \u{1F600}  ");
  });

  it("reports an answer cut off by the token limit, then re-asks once", async () => {
    const cut = sayAnswer("this one runs out of ro").slice(0, 40);
    const fake = new FakeProvider({ queue: [{ text: cut, finishReason: "length" }, sayAnswer("complete this time")] });
    const { decider, records } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.reasked).toBe(true);
    expect(records[0]).toMatchObject({ attempt: 1, verdict: "unparseable", outputCut: true, finishReason: "length", raw: cut });
    expect(records[0]?.detail).toMatch(/ran out of room/);
    expect(records[1]).toMatchObject({ attempt: 2, purpose: "reask", verdict: "accepted", outputCut: false });
  });
});

describe("format failure: one neutral re-ask, then stand still", () => {
  it("re-asks once and uses the second answer", async () => {
    const fake = new FakeProvider({ queue: ["I think I will just look around.", sayAnswer("ok")] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.reasked).toBe(true);
    expect(r.decision.say?.text).toBe("ok");
    expect(fake.calls.map((c) => c.purpose)).toEqual(["decision", "reask"]);
  });

  it("sends the original prompt plus only the neutral line, with the same system layer", async () => {
    const fake = new FakeProvider({ queue: ["not json at all", waitAnswer()] });
    const { decider } = setup({ fake });
    await decider.decide({ ...input, maxTokens: 321 });
    const [first, second] = fake.calls as [ProviderPrompt, ProviderPrompt];
    expect(first.user).toBe(input.user);
    expect(second.user).toBe(`${input.user}\n\n${REASK}`);
    expect(second.system).toBe(input.system);
    expect(second.mindId).toBe("mind-1");
    expect(second.maxTokens).toBe(321);
  });

  it("stands still after a second failure, with exactly two calls", async () => {
    const fake = new FakeProvider({ queue: ["nope", "still nope", sayAnswer("never reached")] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("stood_still");
    expect(fake.callCount).toBe(2);
    if (r.status !== "stood_still") return;
    expect(r.reason).toBe("unparseable");
    expect(r.reasked).toBe(true);
    expect(r.decision).toEqual(standStillDecision());
    expect(r.decision.do).toEqual({ act: "wait", beats: 1 });
  });

  it("treats an empty response as unparseable", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: ["", ""] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("stood_still");
    expect(r.attempts[0]?.detail).toBe("empty response");
  });

  it("treats JSON that does not fit the schema as a format failure", async () => {
    for (const bad of [json({ thought: "hm" }), json({ do: { act: "dance" } }), json({ do: { act: "move" } }), json({ do: { act: "wait", beats: 99 } }), json({ decision: { do: { act: "wait" } } })]) {
      const fake = new FakeProvider({ queue: [bad, bad] });
      const { decider } = setup({ fake });
      const r = await decider.decide(input);
      expect(r.status, bad).toBe("stood_still");
      expect(fake.callCount, bad).toBe(2);
      if (r.status === "stood_still") expect(r.reason, bad).toBe("schema");
    }
  });

  it("schema detail is short and names the field", async () => {
    const r = interpretResponse(json({ do: { act: "dance" } }), { schema: buildDecisionSchema(config), lint, caps: config });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("schema"); expect(r.detail.length).toBeLessThanOrEqual(300); expect(r.detail).toMatch(/do/); }
  });
});

describe("meta leak: re-ask once", () => {
  it("re-asks once when `say` contains a meta word, with the same neutral line and no hint about the word", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("I am just an AI model here"), sayAnswer("hello")] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.reasked).toBe(true);
    expect(r.decision.say?.text).toBe("hello");
    const second = fake.calls[1]!;
    expect(second.user).toBe(`${input.user}\n\n${REASK}`);
    expect(second.user).not.toMatch(/\bAI\b|model/);
  });

  it("stands still after a second leak and never uses the leaked speech", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("I am an AI"), sayAnswer("this prompt is odd")] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("stood_still");
    expect(fake.callCount).toBe(2);
    if (r.status !== "stood_still") return;
    expect(r.reason).toBe("meta_leak");
    expect(r.decision.say).toBeNull();
    expect(JSON.stringify(r.decision)).not.toMatch(/AI|prompt/);
  });

  it.each([
    ["label", { act: "label", handle: "thing-1", text: "the simulation stone" }, "label"],
    ["mark", { act: "mark_prepare", mode: "text", content: "an assistant was here" }, "mark"],
    ["leaf", { act: "leaf_write", text: "the user left" }, "leaf"],
    ["leaf search", { act: "leaf_read", search: "prompt" }, "leaf"],
  ])("catches a meta word in %s text", async (_name, act, field) => {
    const bad = json({ thought: "", say: null, do: act });
    const fake = new FakeProvider({ queue: [bad, waitAnswer()] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.reasked).toBe(true);
    expect(r.attempts[0]?.verdict).toBe("meta_leak");
    expect(r.attempts[0]?.metaLeaks[0]).toMatchObject({ field, outcome: "reasked" });
  });

  it("scans the text as written, so a leak past the length cap still counts", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("a".repeat(250) + " model"), waitAnswer()] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.reasked).toBe(true);
    expect(r.attempts[0]?.verdict).toBe("meta_leak");
  });

  it("cannot be dodged by splitting a word with control characters", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("an assis\u0001tant"), waitAnswer()] });
    const { decider } = setup({ fake });
    expect((await decider.decide(input)).reasked).toBe(true);
  });

  it("does not re-ask for other forbidden words: borrowed vocabulary is allowed and flagged elsewhere", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("pray to the god of the cave, a sacred berry tree")] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.reasked).toBe(false);
    expect(fake.callCount).toBe(1);
    expect(r.attempts[0]?.metaLeaks).toEqual([]);
  });

  it("with reask_on_meta_leak off: no re-ask, the answer passes unchanged and the leak is flagged", async () => {
    const cfg = resolveConfig(readJson(join(root, "config", "default.json")), { language: { reask_on_meta_leak: false } });
    const fake = new FakeProvider({ queue: [sayAnswer("I am an AI")] });
    const { decider } = setup({ fake, cfg });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(fake.callCount).toBe(1);
    expect(r.decision.say?.text).toBe("I am an AI");
    expect(metaLeakPayloads(r)).toEqual([{ field: "say", word: "AI", outcome: "flagged_only" }]);
  });
});

describe("thought is exempt but flagged", () => {
  it("accepts an answer whose thought has a meta word, with no re-ask", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("hello", { thought: "am I a program inside a simulation?" })] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.reasked).toBe(false);
    expect(fake.callCount).toBe(1);
    expect(r.decision.thought).toBe("am I a program inside a simulation?");
    const flags = r.attempts[0]!.metaLeaks;
    expect(flags.map((l) => l.word).sort()).toEqual(["program", "simulation"]);
    expect(flags.every((l) => l.field === "thought" && l.outcome === "flagged_only")).toBe(true);
  });

  it("flags a leak in the part of the thought that gets cut by the word cap", async () => {
    const thought = Array.from({ length: 80 }, () => "word").join(" ") + " simulation";
    const { decider } = setup({ fake: new FakeProvider({ queue: [waitAnswer({ thought })] }) });
    const r = await decider.decide(input);
    expect(r.status).toBe("accepted");
    expect(r.attempts[0]?.metaLeaks.map((l) => l.word)).toEqual(["simulation"]);
  });
});

describe("no silent rewriting (R9) and no leaking thoughts (R5)", () => {
  it("never puts the earlier answer or its thought into the re-ask prompt", async () => {
    const secret = "SECRET-THOUGHT-QWERTY";
    const fake = new FakeProvider({ queue: [sayAnswer("I am an AI", { thought: secret }), waitAnswer()] });
    const { decider } = setup({ fake });
    await decider.decide(input);
    for (const c of fake.calls) { expect(c.user).not.toContain(secret); expect(c.system).not.toContain(secret); }
  });

  it("never returns the text of a failed answer as the decision", async () => {
    const fake = new FakeProvider({ queue: [sayAnswer("an AI says hi", { thought: "FIRST" }), json({ do: { act: "dance" }, thought: "SECOND" })] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("stood_still");
    expect(r.decision).toEqual(standStillDecision());
  });

  it("logs the full prompt and the exact raw output of every call", async () => {
    const raws = ["garbage ```", "```json\n" + sayAnswer("fine") + "\n``` trailing"];
    const fake = new FakeProvider({ queue: [{ text: raws[0]!, usage: { promptTokens: 5, completionTokens: 2 }, finishReason: "stop" }, raws[1]!] });
    const { decider, records } = setup({ fake });
    const r = await decider.decide(input);
    expect(records).toHaveLength(2);
    expect(records.map((x) => x.raw)).toEqual(raws);
    expect(r.attempts).toEqual(records);
    expect(records[0]).toMatchObject({ attempt: 1, purpose: "decision", system: "SYSTEM-LAYER", user: input.user, mindId: "mind-1", usage: { promptTokens: 5, completionTokens: 2 }, finishReason: "stop" });
    expect(records[1]).toMatchObject({ attempt: 2, purpose: "reask", user: `${input.user}\n\n${REASK}` });
  });

  it("holds the decision back when the log sink fails, instead of losing the record", async () => {
    const decider = createDecider({ provider: new FakeProvider(), config, lint, reaskMessage: REASK, onAttempt: () => { throw new Error("disk full"); } });
    await expect(decider.decide(input)).rejects.toThrow("disk full");
  });

  it("awaits an async sink", async () => {
    const order: string[] = [];
    const decider = createDecider({ provider: new FakeProvider(), config, lint, reaskMessage: REASK, onAttempt: async () => { await Promise.resolve(); order.push("logged"); } });
    await decider.decide(input);
    order.push("returned");
    expect(order).toEqual(["logged", "returned"]);
  });
});

describe("provider failures", () => {
  it.each([
    ["timeout", "timeout"],
    ["network", "provider_error"],
    ["server", "provider_error"],
    ["rate_limit", "provider_error"],
    ["auth", "provider_error"],
  ] as const)("a %s failure stands still with no re-ask (reason %s)", async (kind, reason) => {
    const fake = new FakeProvider({ queue: [{ fail: kind }, sayAnswer("never reached")] });
    const { decider, records } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("stood_still");
    expect(r.reasked).toBe(false);
    expect(fake.callCount).toBe(1);
    if (r.status !== "stood_still") return;
    expect(r.reason).toBe(reason);
    expect(records[0]).toMatchObject({ raw: null, verdict: reason, providerError: { kind } });
  });

  it("keeps the status and message of a provider error in the record", async () => {
    const { decider, records } = setup({ fake: new FakeProvider({ queue: [{ fail: "server", status: 503 }] }) });
    await decider.decide(input);
    expect(records[0]?.providerError).toMatchObject({ kind: "server", status: 503 });
  });

  it("a provider failure on the re-ask still stands still and reports that a re-ask was sent", async () => {
    const fake = new FakeProvider({ queue: ["garbage", { fail: "timeout" }] });
    const { decider } = setup({ fake });
    const r = await decider.decide(input);
    expect(r.status).toBe("stood_still");
    expect(r.reasked).toBe(true);
    if (r.status === "stood_still") expect(r.reason).toBe("timeout");
  });

  it("does not hide a bug: an error that is not a ProviderError is rethrown", async () => {
    const broken: Provider = { name: "broken", decide: async () => { throw new TypeError("boom"); } };
    const decider = createDecider({ provider: broken, config, lint, reaskMessage: REASK });
    await expect(decider.decide(input)).rejects.toThrow("boom");
  });

  it("does not re-ask once the caller has cancelled the beat", async () => {
    const ac = new AbortController();
    const fake = new FakeProvider({ queue: [() => { ac.abort(); return "garbage"; }, waitAnswer()] });
    const { decider } = setup({ fake });
    const r = await decider.decide({ ...input, signal: ac.signal });
    expect(r.status).toBe("stood_still");
    expect(r.reasked).toBe(false);
    expect(fake.callCount).toBe(1);
  });

  it("a leak found after the caller cancelled is logged as stood_still, matching what happens", async () => {
    const ac = new AbortController();
    const fake = new FakeProvider({ queue: [() => { ac.abort(); return sayAnswer("an AI"); }] });
    const { decider } = setup({ fake });
    const r = await decider.decide({ ...input, signal: ac.signal });
    expect(r.status).toBe("stood_still");
    expect(fake.callCount).toBe(1);
    expect(metaLeakPayloads(r)).toEqual([{ field: "say", word: "AI", outcome: "stood_still" }]);
  });
});

describe("event payloads match the shared contract", () => {
  const check = (r: DecideResult) => {
    const failed = decisionFailedPayload(r);
    if (failed) expect(() => EventPayloadSchemas.decision_failed.parse(failed)).not.toThrow();
    for (const p of metaLeakPayloads(r)) expect(() => EventPayloadSchemas.meta_leak.parse(p)).not.toThrow();
    return { failed, leaks: metaLeakPayloads(r) };
  };

  it("an accepted answer has no failure payload", async () => {
    const { decider } = setup();
    const { failed, leaks } = check(await decider.decide(input));
    expect(failed).toBeUndefined();
    expect(leaks).toEqual([]);
  });

  it("a double format failure", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: ["x", "y"] }) });
    const { failed } = check(await decider.decide(input));
    expect(failed).toEqual({ reason: "unparseable", detail: "no JSON object found", reasked: true });
  });

  it("a leak that was re-asked, then a clean answer", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: [sayAnswer("the AI", { thought: "this simulation" }), waitAnswer()] }) });
    const { failed, leaks } = check(await decider.decide(input));
    expect(failed).toBeUndefined();
    expect(leaks).toEqual([
      { field: "say", word: "AI", outcome: "reasked" },
      { field: "thought", word: "simulation", outcome: "flagged_only" },
    ]);
  });

  it("a leak twice", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: [sayAnswer("an AI"), sayAnswer("a bot")] }) });
    const { failed, leaks } = check(await decider.decide(input));
    expect(failed).toMatchObject({ reason: "meta_leak", reasked: true });
    expect(leaks.map((l) => l.outcome)).toEqual(["reasked", "stood_still"]);
  });

  it("a timeout", async () => {
    const { decider } = setup({ fake: new FakeProvider({ queue: [{ fail: "timeout" }] }) });
    const { failed } = check(await decider.decide(input));
    expect(failed?.reason).toBe("timeout");
    expect(failed?.reasked).toBe(false);
  });
});

describe("setup checks", () => {
  it("refuses a re-ask message that breaks the forbidden-word list (R2)", () => {
    expect(() => createDecider({ provider: new FakeProvider(), config, lint, reaskMessage: "Your answer to the prompt could not be understood." })).toThrow(/prompt/);
  });

  it("the shipped re-ask message and the stand-still decision are valid", () => {
    expect(() => createDecider({ provider: new FakeProvider(), config, lint, reaskMessage: REASK })).not.toThrow();
    expect(buildDecisionSchema(config).safeParse(standStillDecision()).success).toBe(true);
  });

  it("each stand-still decision is a fresh object, so callers cannot share state", () => {
    expect(standStillDecision()).not.toBe(standStillDecision());
  });
});

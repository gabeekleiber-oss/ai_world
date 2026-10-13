import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildDecisionSchema, capDecision, extractJsonObject, normalizeDrawing, ClientMessageSchema, EventSchema, ServerMessageSchema, isNewer } from "../src";
import { loadConfig } from "../src/node";

const cfg = loadConfig(resolve(__dirname, "../../.."));
const Decision = buildDecisionSchema(cfg);

describe("decision schema", () => {
  it("accepts the documented example", () => {
    const d = Decision.parse({ thought: "I am hungry.", say: { text: "Come here.", volume: "normal", to: "other-1" }, do: { act: "move", to: "thing-3", gait: "walk" } });
    expect(d.do.act).toBe("move");
  });
  it("say is optional and null means silent; wait is valid", () => {
    expect(Decision.parse({ do: { act: "wait" } }).do).toEqual({ act: "wait", beats: 1 });
    expect(Decision.parse({ thought: "", say: null, do: { act: "rest" } }).say).toBeNull();
  });
  it("rejects bad handles, unknown acts, and out-of-range numbers", () => {
    expect(Decision.safeParse({ do: { act: "move", to: "bush-3" } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "fly" } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "move", heading: "ahead", steps: 31 } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "wait", beats: 6 } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "hit", target: "other-1" } }).success).toBe(false);
  });
  it("cross-field rules: move, mark_prepare, leaf_read", () => {
    expect(Decision.safeParse({ do: { act: "move" } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "move", heading: "left", steps: 5, gait: "run" } }).success).toBe(true);
    expect(Decision.safeParse({ do: { act: "mark_prepare", mode: "drawing", content: "text" } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "leaf_read" } }).success).toBe(false);
    expect(Decision.safeParse({ do: { act: "leaf_read", last_n: 6 } }).success).toBe(false);
  });
  it("caps text, strips control characters, and reports truncations without rewriting content", () => {
    const long = "x".repeat(300);
    const d = Decision.parse({ thought: Array(80).fill("w").join(" "), say: { text: `hi\u0007${long}`, volume: "loud", to: null }, do: { act: "label", handle: "thing-1", text: "y".repeat(50) } });
    const { decision, truncations } = capDecision(d, cfg);
    expect(decision.say!.text.startsWith("hix")).toBe(true);
    expect(decision.say!.text).toHaveLength(cfg.actions.say_max_chars);
    expect(decision.thought.split(" ")).toHaveLength(cfg.actions.thought_max_words);
    expect(truncations.map((t) => t.field).sort()).toEqual(["do.text", "say.text", "thought"]);
    const clean = capDecision(Decision.parse({ say: { text: "Come here, I found sweet things.", volume: "normal", to: null }, do: { act: "wait" } }), cfg);
    expect(clean.truncations).toEqual([]);
    expect(clean.decision.say!.text).toBe("Come here, I found sweet things.");
  });
});

describe("extractJsonObject", () => {
  it("handles code fences, preamble and trailing text", () => {
    expect(extractJsonObject('```json\n{"do":{"act":"wait"}}\n``` hope that helps')).toEqual({ do: { act: "wait" } });
    expect(extractJsonObject('Sure! {"say":{"text":"a } b"},"do":{"act":"rest"}} done')).toEqual({ say: { text: "a } b" }, do: { act: "rest" } });
  });
  it("returns undefined when nothing parses", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
    expect(extractJsonObject("{broken")).toBeUndefined();
  });
});

describe("drawing normalization", () => {
  it("clamps values and drops excess strokes and points", () => {
    const stroke = { pigment: "red" as const, width: "thin" as const, points: [[-5, 99], [10, 10]] as [number, number][] };
    const { drawing, truncated } = normalizeDrawing({ strokes: Array(30).fill(stroke) }, { maxStrokes: 24, maxPoints: 600, canvas: [100, 50] });
    expect(truncated).toBe(true);
    expect(drawing.strokes).toHaveLength(24);
    expect(drawing.strokes[0]!.points[0]).toEqual([0, 50]);
  });
});

describe("protocol", () => {
  it("viewer may only send control or replay requests", () => {
    expect(ClientMessageSchema.safeParse({ type: "control", command: "pause" }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "spawn_food", at: [0, 0] }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "control", command: "kill_agent" }).success).toBe(false);
  });
  it("server messages validate, including events", () => {
    const ev = EventSchema.parse({ seq: 3, game_day: 0, beat: 3, real_time: "2026-10-13T00:00:00Z", type: "eat", actor: "m1" });
    expect(ServerMessageSchema.safeParse({ type: "event", event: ev }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: "banner", kind: "outage", text: "x" }).success).toBe(true);
    expect(EventSchema.safeParse({ ...ev, type: "teleport" }).success).toBe(false);
  });
  it("event replay is idempotent by sequence number", () => {
    expect(isNewer({ seq: 5 }, 5)).toBe(false);
    expect(isNewer({ seq: 6 }, 5)).toBe(true);
  });
});

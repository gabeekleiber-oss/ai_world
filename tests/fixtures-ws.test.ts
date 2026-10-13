import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentStateSchema, BushSchema, ServerMessageSchema, TypedEventSchema, type ServerMessage } from "../packages/shared/src";
import { generate } from "../fixtures/ws/generate";

const file = resolve(__dirname, "../fixtures/ws/two-days.jsonl");
const text = readFileSync(file, "utf8");
const msgs: ServerMessage[] = text.trim().split("\n").map((l) => ServerMessageSchema.parse(JSON.parse(l)));
const events = msgs.flatMap((m) => (m.type === "event" ? [m.event] : []));

describe("fixtures/ws/two-days.jsonl", () => {
  it("every line is a valid ServerMessage and every event payload is typed", () => {
    for (const e of events) expect(TypedEventSchema.safeParse(e).success, `${e.type} seq ${e.seq}`).toBe(true);
  });
  it("covers every server message type", () => {
    const types = new Set(msgs.map((m) => m.type));
    for (const t of ["hello", "world_state", "beat_plan", "event", "speech", "thought", "mark_committed", "leaf_written", "budget", "banner"]) expect(types.has(t as never), t).toBe(true);
  });
  it("starts with hello, spans two game days, and has increasing seq and non-decreasing beats", () => {
    expect(msgs[0]!.type).toBe("hello");
    expect(Math.max(...events.map((e) => e.game_day))).toBe(1);
    events.forEach((e, i) => { if (i) { expect(e.seq).toBe(events[i - 1]!.seq + 1); expect(e.beat).toBeGreaterThanOrEqual(events[i - 1]!.beat); } });
  });
  it("includes a stone speech with a listener, a mark, a leaf, a death and an arrival", () => {
    expect(msgs.some((m) => m.type === "speech" && m.from_stone)).toBe(true);
    for (const t of ["gathering_speech", "mark_committed", "leaf_written", "death", "arrival"]) expect(events.some((e) => e.type === t), t).toBe(true);
  });
  it("world_state agents and bushes validate against the state schemas", () => {
    const ws = msgs.filter((m) => m.type === "world_state");
    expect(ws.length).toBeGreaterThanOrEqual(3);
    for (const m of ws) if (m.type === "world_state") { m.agents.forEach((a) => AgentStateSchema.parse(a)); m.bushes.forEach((b) => BushSchema.parse(b)); }
  });
  it("is reproducible from the generator", () => { expect(generate()).toBe(text); });
});

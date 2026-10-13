import { describe, expect, it } from "vitest";
import { EVENT_TYPES, EventPayloadSchemas, TypedEventSchema, parseTypedEvent, type EventType } from "../src";

const p = { x: 1, z: 2 };
const SAMPLES: { [T in EventType]: unknown } = {
  beat_start: { phase: "day", awake: ["mind-1"], deciding: ["mind-1"] },
  decision: { act: "move", params: { to: "thing-3", gait: "walk" }, say: { text: "Come here.", volume: "normal", to: null } },
  decision_failed: { reason: "unparseable", reasked: true },
  action_started: { act: "move", duration_beats: 2, target: "bush-1" },
  action_result: { act: "pick", ok: false, code: "too_far" },
  move: { from: p, to: { x: 4, z: 2 }, gait: "run", steps: 14 },
  pick: { bush: "bush-1", count: 1, carried_after: 3 },
  eat: { source: "held", count: 1, satiety_after: 82 },
  give: { to: "mind-2", count: 2 },
  take: { from: "mind-3", count: 1, forced: true, contest_won: false },
  hit: { target: "mind-2", force: "hard", landed: true, damage: 14.2, target_health: 71, staggered: true },
  push: { target: "mind-2", knocked_down: false },
  death: { cause: "injury", age_days: 33.5, by: "mind-4" },
  arrival: { slot: 3, kind: "priest-kit", age_days: 15, pos: p, priest_number: 2 },
  sleep_start: { forced: false },
  sleep_end: { reason: "rested" },
  speech: { text: "hello", volume: "loud", to: "mind-2", from_stone: true, heard_by: ["mind-2", "mind-3"] },
  gathering_speech: { text: "listen", listeners: ["mind-2"] },
  gesture: { kind: "beckon", target: "mind-2" },
  label: { target: "bush-1", text: "redsweet" },
  study: { mark_id: 4 },
  mark_prepared: { mode: "drawing", wall_slot: 7 },
  mark_committed: { mark_id: 5, wall_slot: 7, kind: "text", witnesses: ["mind-1"] },
  mark_abandoned: { reason: "death" },
  leaf_written: { priest_number: 1, entry_id: 0, text: "first leaf" },
  leaf_read: { priest_number: 1, entries: 3, query: "light" },
  memory_compacted: { decisions_since_last: 25, words: 118 },
  meta_leak: { field: "say", word: "bot", outcome: "reasked" },
  lexicon_new_token: { token: "zel", source: "say" },
  api_throttle: { status: 429, wait_ms: 4000, new_rpm: 24 },
  api_outage: { state: "begin" },
  snapshot_saved: { path: "world/snapshot-latest.json", last_seq: 1200 },
};
const env = (type: EventType, data: unknown) => ({ seq: 1, game_day: 0, beat: 1, real_time: "2026-10-13T00:00:00Z", type, actor: "mind-1", data });

describe("event payloads", () => {
  it("has a payload schema and a valid sample for every event type", () => {
    expect(Object.keys(EventPayloadSchemas).sort()).toEqual([...EVENT_TYPES].sort());
    for (const t of EVENT_TYPES) expect(() => EventPayloadSchemas[t].parse(SAMPLES[t]), t).not.toThrow();
  });
  it("accepts every sample inside a full event, and parseTypedEvent narrows by type", () => {
    for (const t of EVENT_TYPES) expect(TypedEventSchema.safeParse(env(t, SAMPLES[t])).success, t).toBe(true);
    const e = parseTypedEvent(env("hit", SAMPLES.hit));
    if (e.type === "hit") expect(e.data.damage).toBeCloseTo(14.2);
  });
  it("rejects a wrong payload, an unknown field, and an unknown type", () => {
    expect(TypedEventSchema.safeParse(env("pick", { bush: "bush-1" })).success).toBe(false);
    expect(TypedEventSchema.safeParse(env("pick", { bush: "bush-1", count: 1, carried_after: 1, extra: true })).success).toBe(false);
    expect(TypedEventSchema.safeParse(env("pick" as EventType, SAMPLES.pick)).success).toBe(true);
    expect(TypedEventSchema.safeParse({ ...env("pick", SAMPLES.pick), type: "teleport" }).success).toBe(false);
  });
  it("keeps private thoughts out of decision events", () => {
    expect(TypedEventSchema.safeParse(env("decision", { ...(SAMPLES.decision as object), thought: "secret" })).success).toBe(false);
  });
});

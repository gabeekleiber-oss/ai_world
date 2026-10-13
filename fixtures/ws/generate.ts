/**
 * Generates fixtures/ws/two-days.jsonl: a scripted two-game-day stream of ServerMessages for the viewer and other consumers to
 * develop against with no sim running. It is not engine output: movement is a simple walk toward goals, and one arrival is
 * compressed to a few beats after the death instead of the real 3-day delay. Run: npx tsx fixtures/ws/generate.ts
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { ServerMessageSchema, type ServerMessage, type SimEvent, type EventType, type PayloadOf, type AgentState, type Bush, type Vec2 } from "../../packages/shared/src";
import { loadConfig } from "../../packages/shared/src/node";
import { clockAt, createWorld } from "../../packages/sim/src";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BEATS = 80, SPEED = 8, DEATH_BEAT = 70, ARRIVAL_BEAT = 77;
const T0 = Date.parse("2026-10-13T12:00:00Z");
const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function generate(): string {
  const cfg = loadConfig(root);
  const w = createWorld(cfg);
  const L = w.layout, hall = L.hall.center;
  const slab: Vec2 = { x: hall.x, z: hall.z + L.hall.size_m[1] / 2 - 1 };
  const out: ServerMessage[] = [];
  let seq = 0;
  const at = (beat: number) => ({ game_day: Math.floor(beat / 40), beat });
  const ev = <T extends EventType>(beat: number, type: T, actor: string | undefined, data: PayloadOf<T>) => {
    const e: SimEvent = { schema_version: 1, seq: seq++, ...at(beat), real_time: new Date(T0 + beat * 6000).toISOString(), type, actor, data: data as Record<string, unknown> };
    out.push({ type: "event", event: e });
  };

  type Goal = { pos: Vec2; hold: number };
  const goals: Record<string, Goal[]> = {
    "mind-1": [{ pos: L.bushes[0]!.pos, hold: 4 }, { pos: hall, hold: 12 }, { pos: L.bushes[0]!.pos, hold: 99 }],
    "mind-2": [{ pos: L.bushes[1]!.pos, hold: 10 }, { pos: { x: L.pond.center.x + L.pond.radius_m + 2, z: L.pond.center.z }, hold: 99 }],
    "mind-3": [{ pos: L.cave.mouth, hold: 99 }],
    "mind-4": [],
  };
  const pos: Record<string, Vec2> = {}, goalIdx: Record<string, number> = {}, held: Record<string, number> = {}, carried: Record<string, number> = {};
  const alive: Record<string, boolean> = {};
  const bodiesById = new Map(w.bodies.map((b) => [b.id, b]));
  for (const b of w.bodies) { pos[b.id] = b.id === "mind-4" ? slab : { ...b.pos }; goalIdx[b.id] = 0; held[b.id] = 0; carried[b.id] = 0; alive[b.id] = true; }
  const berries = w.bushes.map((b): Bush => ({ ...b }));
  let marks = { "mind-3": 2 } as Record<string, number>;
  const state = { m3Arrived: -1, m1HallArrived: -1, m1Prepared: false, wroteLeaf: false, spoke: false, committed: false, newMind: false };
  let markId = 0, leafId = 0;

  const agents = (beat: number): AgentState[] => [...bodiesById.values()].filter((b) => alive[b.id] || b.id === "mind-2").map((b) => ({
    ...b, pos: { x: r2(pos[b.id]!.x), z: r2(pos[b.id]!.z) }, satiety: Math.max(0, r2(b.satiety - beat * 0.9 + carried[b.id]! * 6)), fatigue: Math.min(100, r2(beat * 0.8)),
    alive: alive[b.id]!, awake: alive[b.id]!, carried: Array.from({ length: carried[b.id]! }, () => Math.max(0, beat - 3)),
    lifecycle: alive[b.id] ? "awake" : "still_body", marks_left: marks[b.id] ?? 2,
  }));
  const worldState = (beat: number): ServerMessage => ({
    type: "world_state", at: at(beat), time_of_day: clockAt(beat, cfg.time).beatOfDay / cfg.time.beats_per_day, agents: agents(beat) as never[],
    bushes: berries as never[], bodies: alive["mind-2"] ? [] : [{ id: "still-mind-2", pos: pos["mind-2"], since_beat: DEATH_BEAT }], objects: [{ id: "slab-1", kind: "stone_slab", pos: slab }],
  });

  out.push({ type: "hello", run_id: "fixture-two-days", schema_version: 1, config_summary: { seed: cfg.run.seed, arm: cfg.run.arm, beats_per_day: 40, fixture: true }, current_beat: at(0) });

  for (let beat = 0; beat < BEATS; beat++) {
    if (beat % 20 === 0 || beat === BEATS - 1) out.push(worldState(beat));
    const c = clockAt(beat, cfg.time);
    const living = Object.keys(alive).filter((k) => alive[k]);
    ev(beat, "beat_start", undefined, { phase: c.phase, awake: living, deciding: living });
    const plans: Array<{ mind_id: string; act: string; duration_beats: number; path?: [number, number][] }> = [];
    const after: Array<() => void> = [];
    for (const id of living) {
      const gs = goals[id] ?? [], g = gs[goalIdx[id]!], from = { ...pos[id]! };
      if (g && d(pos[id]!, g.pos) > 0.01) {
        const step = Math.min(SPEED, d(pos[id]!, g.pos)), k = step / d(pos[id]!, g.pos);
        pos[id] = { x: pos[id]!.x + (g.pos.x - pos[id]!.x) * k, z: pos[id]!.z + (g.pos.z - pos[id]!.z) * k };
        plans.push({ mind_id: id, act: "move", duration_beats: 1, path: [[r2(from.x), r2(from.z)], [r2(pos[id]!.x), r2(pos[id]!.z)]] });
        after.push(() => ev(beat, "move", id, { from, to: { ...pos[id]! }, gait: "walk", steps: r2(step) }));
        if (d(pos[id]!, g.pos) < 0.01) held[id] = 0;
      } else {
        plans.push({ mind_id: id, act: "wait", duration_beats: 1 });
        if (g) { held[id]!++; if (held[id]! >= g.hold && goalIdx[id]! < gs.length - 1) { goalIdx[id]!++; held[id] = 0; } }
      }
    }
    out.push({ type: "beat_plan", at: at(beat), beat_seconds: cfg.time.beat_seconds, plans });
    for (const f of after) f();

    // mind-1: picks and eats at the first bush, then walks to the hall.
    const g1 = goals["mind-1"]![0]!;
    if (alive["mind-1"] && goalIdx["mind-1"] === 0 && d(pos["mind-1"]!, g1.pos) < 0.01) {
      const bi = 0, b = berries[bi]!;
      if (held["mind-1"]! >= 1 && held["mind-1"]! <= 2) { b.berries -= 1; carried["mind-1"]!++; ev(beat, "pick", "mind-1", { bush: b.id, count: 1, carried_after: carried["mind-1"]! }); }
      if (held["mind-1"] === 3) { carried["mind-1"]!--; ev(beat, "eat", "mind-1", { source: "held", count: 1, satiety_after: 72 }); out.push({ type: "thought", at: at(beat), mind_id: "mind-1", text: "Sweet. The ache eases. Is there more of this?" }); }
      if (held["mind-1"] === 0 && beat > 1 && !state.spoke) out.push({ type: "speech", at: at(beat), speaker: "mind-1", text: "Over here. Red and sweet.", volume: "loud", to: null, from_stone: false }), ev(beat, "speech", "mind-1", { text: "Over here. Red and sweet.", volume: "loud", to: null, from_stone: false, heard_by: ["mind-2"] });
    }
    // mind-1 reaches the hall; mind-4 speaks from the slab, then writes a leaf.
    if (alive["mind-1"] && goalIdx["mind-1"] === 1 && d(pos["mind-1"]!, hall) < 0.01 && state.m1HallArrived < 0) state.m1HallArrived = beat;
    if (state.m1HallArrived >= 0 && beat === state.m1HallArrived + 1) {
      const text = "Listen. The light goes and comes back.";
      out.push({ type: "speech", at: at(beat), speaker: "mind-4", text, volume: "normal", to: null, from_stone: true });
      ev(beat, "speech", "mind-4", { text, volume: "normal", to: null, from_stone: true, heard_by: ["mind-1"] });
      ev(beat, "gathering_speech", "mind-4", { text, listeners: ["mind-1"] });
      state.spoke = true;
    }
    if (state.m1HallArrived >= 0 && beat === state.m1HallArrived + 3 && !state.wroteLeaf) {
      const text = "The light goes and comes back. One listened.";
      ev(beat, "leaf_written", "mind-4", { priest_number: 1, entry_id: leafId, text });
      out.push({ type: "leaf_written", priest_number: 1, entry_id: leafId++, text }); state.wroteLeaf = true;
    }
    // mind-3 reaches the cave: prepare, commit two beats later.
    if (alive["mind-3"] && d(pos["mind-3"]!, L.cave.mouth) < 0.01 && state.m3Arrived < 0) state.m3Arrived = beat;
    if (state.m3Arrived >= 0 && beat === state.m3Arrived + 1) ev(beat, "mark_prepared", "mind-3", { mode: "drawing", wall_slot: 0 });
    if (state.m3Arrived >= 0 && beat === state.m3Arrived + 3 && !state.committed) {
      ev(beat, "mark_committed", "mind-3", { mark_id: markId, wall_slot: 0, kind: "drawing", witnesses: [] });
      out.push({ type: "mark_committed", mark_id: markId, files: { json: `cave/marks/${markId}.json`, svg: `cave/marks/${markId}.svg`, png: `cave/marks/${markId}.png` } });
      markId++; marks["mind-3"]!--; state.committed = true;
    }
    if (beat === 50) out.push({ type: "banner", kind: "outage", text: "The valley is frozen while the connection recovers." });
    if (beat === 52) out.push({ type: "banner", kind: "info", text: "Connection restored." });
    if (beat % 10 === 0) out.push({ type: "budget", calls: beat * 3, tokens_in: beat * 5400, tokens_out: beat * 450, rate_rpm: 30, health: beat === 50 ? "down" : "ok" });
    if (beat === DEATH_BEAT) { alive["mind-2"] = false; ev(beat, "death", "mind-2", { cause: "starvation", age_days: r2(30 + beat / 40) }); }
    if (beat === ARRIVAL_BEAT && !state.newMind) {
      const rim = { x: r2(L.terrain.wall_radius_m - 2), z: 0 };
      bodiesById.set("mind-5", { ...bodiesById.get("mind-2")!, id: "mind-5", pos: rim, start_age_days: 15, spawn_beat: beat, satiety: 70, death: undefined });
      pos["mind-5"] = rim; goals["mind-5"] = [{ pos: L.bushes[2]!.pos, hold: 99 }]; goalIdx["mind-5"] = 0; held["mind-5"] = 0; carried["mind-5"] = 0; alive["mind-5"] = true; state.newMind = true;
      ev(beat, "arrival", "mind-5", { slot: 1, kind: "plain", age_days: 15, pos: rim });
    }
  }
  return out.map((m) => JSON.stringify(ServerMessageSchema.parse(m))).join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "two-days.jsonl"), generate());
  console.log("wrote fixtures/ws/two-days.jsonl");
}

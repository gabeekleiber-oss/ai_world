import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "@ai-world/shared/node";
import {
  applyWake, clampWait, createWorld, dist, enforceFatigueCeiling, headingToVector, interruptReason, makeMoveOrder, makeTerrain, speedFor,
  startContinuation, startRest, stepMove, stepNeeds, tickContinuation, wakeReason, type Body, type MoveOrder,
} from "../src";

const cfg = loadConfig(resolve(__dirname, "../../.."));
const terrain = makeTerrain(1, cfg.world);
const body = (over: Partial<Body> = {}): Body => ({ ...createWorld(cfg).bodies[0]!, pos: { x: 0, z: 0 }, fatigue: 0, satiety: 100, start_age_days: 15, ...over });
const east = { x: 1, z: 0 };

describe("speeds (section 11)", () => {
  it("walk 8, run 14, drag 3 steps per beat", () => {
    expect([speedFor("walk", cfg), speedFor("run", cfg), speedFor("drag", cfg)]).toEqual([8, 14, 3]);
    for (const [gait, n] of [["walk", 8], ["run", 14], ["drag", 3]] as const) {
      const r = stepMove(body(), { gait, dir: east, stepsLeft: 30, arrive_within: 0 }, terrain, cfg);
      expect(r.moved).toBeCloseTo(n, 3); expect(r.body.pos.x).toBeCloseTo(n, 3);
    }
  });
  it("a target order arrives and stops within the arrival distance", () => {
    const r = stepMove(body(), { gait: "walk", target: { x: 5, z: 0 }, arrive_within: 1.5 }, terrain, cfg);
    expect(r.arrived).toBe(true); expect(r.order).toBeNull(); expect(r.body.pos.x).toBeCloseTo(3.5, 3);
  });
  it("a long target order takes several beats and ends on arrival", () => {
    let b = body(), order: MoveOrder | null = { gait: "walk", target: { x: 20, z: 0 }, arrive_within: 1.5 }, beats = 0;
    while (order && beats < 10) { const r = stepMove(b, order, terrain, cfg); b = r.body; order = r.order; beats++; }
    expect(beats).toBe(3); expect(dist(b.pos, { x: 20, z: 0 })).toBeLessThanOrEqual(1.5 + 1e-6);
  });
  it("a heading order is capped at move_max_steps and runs out", () => {
    const o = makeMoveOrder({ steps: 99 }, cfg, { dir: east });
    expect(o.stepsLeft).toBe(30);
    let b = body(), order: MoveOrder | null = o, beats = 0;
    while (order) { const r = stepMove(b, order, terrain, cfg); b = r.body; order = r.order; beats++; }
    expect(beats).toBe(4); expect(b.pos.x).toBeCloseTo(30, 3);
  });
  it("a sleeping or dead body does not move", () => {
    for (const b of [body({ awake: false }), body({ alive: false })]) {
      const r = stepMove(b, { gait: "run", dir: east, stepsLeft: 10, arrive_within: 0 }, terrain, cfg);
      expect(r.moved).toBe(0); expect(r.body.pos).toEqual(b.pos);
    }
  });
});

describe("run fatigue and forced sleep", () => {
  it("running costs 1.5 fatigue per beat moved; walking costs none", () => {
    const run = stepMove(body(), { gait: "run", dir: east, stepsLeft: 30, arrive_within: 0 }, terrain, cfg);
    expect(run.body.fatigue).toBeCloseTo(1.5, 6);
    const walk = stepMove(body(), { gait: "walk", dir: east, stepsLeft: 30, arrive_within: 0 }, terrain, cfg);
    expect(walk.body.fatigue).toBe(0);
    const still = stepMove(body(), { gait: "run", target: { x: 0, z: 0 }, arrive_within: 1 }, terrain, cfg);
    expect(still.body.fatigue).toBe(0);
  });
  it("fatigue reaching 100 forces sleep and ends the order", () => {
    const r = stepMove(body({ fatigue: 99 }), { gait: "run", dir: east, stepsLeft: 30, arrive_within: 0 }, terrain, cfg);
    expect(r.forced_sleep).toBe(true); expect(r.body.awake).toBe(false); expect(r.body.fatigue).toBe(100); expect(r.order).toBeNull();
  });
  it("passive fatigue at 100 also lies the body down", () => {
    expect(stepNeeds(body({ fatigue: 99.5 }), cfg, 1).body.awake).toBe(false);
    expect(enforceFatigueCeiling(body({ fatigue: 100 }))).toMatchObject({ forced: true });
    expect(enforceFatigueCeiling(body({ fatigue: 50 })).forced).toBe(false);
  });
});

describe("cliff soft boundary", () => {
  it("steep ground costs twice the steps", () => {
    const start = { x: terrain.cliff_start_m + 1, z: 0 };
    const r = stepMove(body({ pos: start }), { gait: "walk", dir: east, stepsLeft: 30, arrive_within: 0 }, terrain, cfg);
    expect(r.moved).toBeCloseTo(4, 3);
  });
  it("nothing crosses the wall at the foot of the cliffs", () => {
    const start = { x: terrain.wall_radius_m - 0.5, z: 0 };
    const r = stepMove(body({ pos: start }), { gait: "run", dir: east, stepsLeft: 30, arrive_within: 0 }, terrain, cfg);
    expect(r.blocked).toBe(true); expect(Math.hypot(r.body.pos.x, r.body.pos.z)).toBeLessThanOrEqual(terrain.wall_radius_m + 1e-6); expect(r.order).toBeNull();
  });
});

describe("headings", () => {
  it("ahead is the facing; left and right are perpendicular and opposite; behind reverses", () => {
    const f = { x: 0, z: -1 };
    const v = (h: Parameters<typeof headingToVector>[1]) => headingToVector(f, h);
    expect(v("ahead").z).toBeCloseTo(-1, 6);
    expect(v("left").x).toBeCloseTo(-1, 6); expect(v("right").x).toBeCloseTo(1, 6); expect(v("behind").z).toBeCloseTo(1, 6);
  });
});

describe("wait and rest", () => {
  it("wait is clamped to 1..5", () => { expect([clampWait(0, cfg), clampWait(3, cfg), clampWait(9, cfg), clampWait(undefined, cfg)]).toEqual([1, 3, 5, 1]); });
  it("rest lies the body down, only if awake and alive", () => {
    expect(startRest(body()).body.awake).toBe(false);
    expect(startRest(body({ awake: false })).ok).toBe(false); expect(startRest(body({ alive: false })).ok).toBe(false);
  });
  it("sleep wake triggers: loud sound within 15 steps, touch, strike, full recovery", () => {
    const asleep = body({ awake: false, fatigue: 60 });
    expect(wakeReason(asleep, { loud_sound_steps: 14 }, cfg)).toBe("loud_sound");
    expect(wakeReason(asleep, { loud_sound_steps: 16 }, cfg)).toBeNull();
    expect(wakeReason(asleep, { touched: true }, cfg)).toBe("touched");
    expect(wakeReason(asleep, { struck: true, touched: true }, cfg)).toBe("struck");
    expect(wakeReason({ ...asleep, fatigue: 0 }, {}, cfg)).toBe("rested");
    expect(wakeReason(body(), { struck: true }, cfg)).toBeNull();
    expect(applyWake(asleep, { touched: true }, cfg).body.awake).toBe(true);
  });
  it("a full sleep from 100 ends with the body awake and rested, in about 12 beats", () => {
    let b = body({ fatigue: 100, awake: false }), n = 0;
    while (!b.awake && n < 40) { b = stepNeeds(b, cfg, ++n).body; }
    expect(n).toBe(13); expect(b.fatigue).toBe(0);
  });
});

describe("continuation and interrupts", () => {
  const mv = () => startContinuation("move", 0, { order: { gait: "walk", target: { x: 100, z: 0 }, arrive_within: 1.5 } });
  it("a move carries on for 3 beats, then the mind is asked again", () => {
    let c = mv(), asked = 0;
    for (let i = 0; i < 3; i++) { const r = tickContinuation(c, {}, cfg); if (!r.continue) { asked = i + 1; expect(r.reason).toBe("max_beats"); break; } c = r.next!; }
    expect(asked).toBe(3);
  });
  it.each([
    [{ new_in_sight: true }, "new_in_sight"], [{ sound: "normal" as const }, "sound"], [{ sound: "loud" as const }, "sound"],
    [{ hurt: true }, "hurt"], [{ arrived: true }, "arrived"], [{ held_changed: true }, "held_changed"],
  ])("re-asks on %j", (signals, reason) => { expect(interruptReason(mv(), signals, cfg)).toBe(reason); });
  it("a whisper does not interrupt", () => { expect(interruptReason(mv(), { sound: "whisper" }, cfg)).toBeNull(); });
  it("hurt outranks everything else", () => { expect(interruptReason(mv(), { hurt: true, arrived: true, new_in_sight: true }, cfg)).toBe("hurt"); });
  it("drag follows the same rules as move", () => {
    const d = startContinuation("drag", 0);
    expect(interruptReason({ ...d, beats_run: 3 }, {}, cfg)).toBe("max_beats"); expect(interruptReason({ ...d, beats_run: 2 }, {}, cfg)).toBeNull();
  });
  it("wait runs for the beats the mind chose, not just 3", () => {
    let c = startContinuation("wait", 0, { wait_beats: 5 }), beats = 0;
    for (;;) { beats++; const r = tickContinuation(c, {}, cfg); if (!r.continue) { expect(r.reason).toBe("wait_done"); break; } c = r.next!; }
    expect(beats).toBe(5);
    expect(interruptReason({ ...startContinuation("wait", 0, { wait_beats: 5 }), beats_run: 2 }, { sound: "loud" }, cfg)).toBe("sound");
  });
  it("rest is not capped and ignores sight and sound; only waking or hurt ends it", () => {
    const r = startContinuation("rest", 0);
    expect(interruptReason({ ...r, beats_run: 50 }, { new_in_sight: true, sound: "normal" }, cfg)).toBeNull();
    expect(interruptReason(r, { woke: true }, cfg)).toBe("woke"); expect(interruptReason(r, { hurt: true }, cfg)).toBe("hurt");
  });
});

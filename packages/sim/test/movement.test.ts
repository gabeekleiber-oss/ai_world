import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "@ai-world/shared/node";
import { createWorld, dist, isWalkable, stepNeeds, type Body } from "../src";
import { angleToHeading, clipToWall, headingToAngle, resolveMove, resolveTurn, stepsPerBeat } from "../src/actions/move";
import { startRest, wakeIfDisturbed, wakesSleeper } from "../src/actions/rest";
import { dragContinuation, moveContinuation, QUIET, restContinuation, retarget, stepContinuation, waitContinuation, type BeatObservations, type Continuation } from "../src/continuation";

const cfg = loadConfig(resolve(__dirname, "../../.."));
const world = createWorld(cfg);
const terrain = world.layout.terrain;
const fresh = (over: Partial<Body> = {}): Body => ({ ...world.bodies[0]!, pos: { x: 0, z: 0 }, start_age_days: 30, fatigue: 0, satiety: 100, ...over });
const obs = (o: Partial<BeatObservations> = {}): BeatObservations => ({ ...QUIET, ...o });
const heading = (steps: number, gait: "walk" | "run" = "walk") => ({ kind: "heading", angle: 0, steps_left: steps, gait }) as const;

describe("speeds (section 11)", () => {
  it("a walk covers 8 steps a beat and a run 14", () => {
    expect(stepsPerBeat(cfg, "walk")).toBe(8);
    expect(stepsPerBeat(cfg, "run")).toBe(14);
    const walk = resolveMove(fresh(), cfg, terrain, 0, heading(30));
    const run = resolveMove(fresh(), cfg, terrain, 0, heading(30, "run"));
    expect(walk.body.pos).toEqual({ x: 8, z: 0 });
    expect(walk.moved_steps).toBe(8);
    expect(run.body.pos).toEqual({ x: 14, z: 0 });
    expect(run.moved_steps).toBe(14);
  });
  it("travels along the requested angle", () => {
    const r = resolveMove(fresh(), cfg, terrain, 0, { kind: "heading", angle: Math.PI / 2, steps_left: 30, gait: "walk" });
    expect(r.body.pos.x).toBeCloseTo(0, 3);
    expect(r.body.pos.z).toBeCloseTo(8, 3);
    expect(r.facing).toBeCloseTo(Math.PI / 2, 9);
  });
  it("a heading move of 30 steps takes four walking beats and then finishes", () => {
    let b = fresh(), left = 30, beats = 0, code = "";
    while (code !== "finished" && beats < 10) {
      const r = resolveMove(b, cfg, terrain, 0, heading(left));
      b = r.body; left = r.steps_left; code = r.code; beats++;
    }
    expect(beats).toBe(4);
    expect(b.pos.x).toBeCloseTo(30, 3);
  });
  it("a short move does not overshoot: it arrives with the steps it was given", () => {
    const r = resolveMove(fresh(), cfg, terrain, 0, heading(5));
    expect(r.moved_steps).toBe(5);
    expect(r.code).toBe("finished");
    expect(r.steps_left).toBe(0);
  });
});

describe("run fatigue", () => {
  it("running costs the configured extra fatigue; walking costs none", () => {
    const run = resolveMove(fresh({ fatigue: 10 }), cfg, terrain, 0, heading(30, "run"));
    expect(run.fatigue_added).toBe(cfg.movement.run_fatigue);
    expect(run.body.fatigue).toBeCloseTo(10 + cfg.movement.run_fatigue, 6);
    const walk = resolveMove(fresh({ fatigue: 10 }), cfg, terrain, 0, heading(30));
    expect(walk.fatigue_added).toBe(0);
    expect(walk.body.fatigue).toBe(10);
  });
  it("a run that goes nowhere costs nothing", () => {
    const r = resolveMove(fresh({ fatigue: 10 }), cfg, terrain, 0, { kind: "heading", angle: 0, steps_left: 0, gait: "run" });
    expect(r.fatigue_added).toBe(0);
    expect(r.body.fatigue).toBe(10);
  });
  it("fatigue never exceeds 100", () => {
    expect(resolveMove(fresh({ fatigue: 99.5 }), cfg, terrain, 0, heading(30, "run")).body.fatigue).toBe(100);
  });
  it("a body that runs itself to 100 is put to sleep by the next beat's needs step (forced sleep)", () => {
    const tired = fresh({ fatigue: 98.9 });
    const ran = resolveMove(tired, cfg, terrain, 0, heading(30, "run")).body;
    expect(ran.fatigue).toBe(100);
    expect(stepNeeds(ran, cfg, 1).body.awake).toBe(false);
  });
});

describe("toward a target", () => {
  it("stops within reach of the target and reports arrival", () => {
    const target = { x: 20, z: 0 };
    let b = fresh(), code = "", beats = 0;
    while (code !== "arrived" && beats < 10) { const r = resolveMove(b, cfg, terrain, 0, { kind: "toward", target, gait: "walk" }); b = r.body; code = r.code; beats++; }
    expect(code).toBe("arrived");
    expect(beats).toBe(3); // 8 + 8 + 2 steps to get within reach 2 of a point 20 away
    expect(dist(b.pos, target)).toBeCloseTo(cfg.combat.reach_steps, 3);
  });
  it("arrives at once, without moving, when already close enough", () => {
    const r = resolveMove(fresh(), cfg, terrain, 0, { kind: "toward", target: { x: 1, z: 0 }, gait: "walk" });
    expect(r.code).toBe("arrived");
    expect(r.moved_steps).toBe(0);
    expect(r.body.pos).toEqual({ x: 0, z: 0 });
  });
  it("honours a custom stop distance and turns to face the target", () => {
    const r = resolveMove(fresh(), cfg, terrain, 0, { kind: "toward", target: { x: 0, z: 30 }, gait: "run", stop_within: 10 });
    expect(r.facing).toBeCloseTo(Math.PI / 2, 9);
    expect(r.code).toBe("moved");
    expect(r.steps_left).toBeCloseTo(20 - 14, 3);
  });
});

describe("the soft boundary (cliff foot)", () => {
  const R = terrain.wall_radius_m;
  it("stops a body at the wall and says the way is too steep", () => {
    const edge = fresh({ pos: { x: R - 3, z: 0 } });
    const r = resolveMove(edge, cfg, terrain, 0, heading(30));
    expect(r.code).toBe("too_steep");
    expect(r.moved_steps).toBeCloseTo(3, 2);
    expect(isWalkable(terrain, r.body.pos)).toBe(true);
    expect(Math.hypot(r.body.pos.x, r.body.pos.z)).toBeGreaterThan(R - 0.01);
    expect(r.steps_left).toBe(0);
  });
  it("a body already at the wall that pushes on does not move", () => {
    const at = resolveMove(fresh({ pos: { x: R - 3, z: 0 } }), cfg, terrain, 0, heading(30)).body;
    const again = resolveMove(at, cfg, terrain, 0, heading(30));
    expect(again.code).toBe("too_steep");
    expect(again.moved_steps).toBeLessThan(0.01);
  });
  it("can walk along the wall and away from it", () => {
    const at = fresh({ pos: { x: R - 0.5, z: 0 } });
    expect(resolveMove(at, cfg, terrain, 0, { kind: "heading", angle: Math.PI, steps_left: 8, gait: "walk" }).code).toBe("finished");
  });
  it("stays inside for any angle and start, to rounding precision", () => {
    for (let i = 0; i < 360; i += 7) {
      const a = (i * Math.PI) / 180, start = { x: Math.cos(a) * (R - 1), z: Math.sin(a) * (R - 1) };
      const r = clipToWall(terrain, start, { x: start.x + Math.cos(a + 0.4) * 14, z: start.z + Math.sin(a + 0.4) * 14 });
      expect(isWalkable(terrain, r.pos)).toBe(true);
    }
  });
});

describe("who can move", () => {
  it("a sleeping or dead body cannot move, and nothing changes", () => {
    for (const over of [{ awake: false }, { alive: false }] as const) {
      const b = fresh(over);
      const r = resolveMove(b, cfg, terrain, 1.5, heading(30));
      expect(r.code).toBe("cannot_act");
      expect(r.body).toBe(b);
      expect(r.facing).toBe(1.5);
    }
  });
  it("does not change its input", () => {
    const b = fresh(), before = structuredClone(b);
    resolveMove(b, cfg, terrain, 0, heading(30, "run"));
    expect(b).toEqual(before);
  });
  it("is deterministic", () => {
    const a = resolveMove(fresh(), cfg, terrain, 0.3, heading(30, "run")), b = resolveMove(fresh(), cfg, terrain, 0.3, heading(30, "run"));
    expect(a).toEqual(b);
  });
});

describe("headings and turning", () => {
  it("ahead is the facing, left is a quarter turn counter-clockwise, right the reverse", () => {
    expect(headingToAngle(0.5, "ahead")).toBeCloseTo(0.5, 9);
    expect(headingToAngle(0, "left")).toBeCloseTo(Math.PI / 2, 9);
    expect(headingToAngle(0, "right")).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(headingToAngle(0, "behind"))).toBeCloseTo(Math.PI, 9);
  });
  it("angleToHeading inverts headingToAngle for every heading and facing", () => {
    for (const facing of [-3, -1, 0, 0.7, 2.9])
      for (const h of ["ahead", "ahead-left", "left", "behind-left", "behind", "behind-right", "right", "ahead-right"] as const)
        expect(angleToHeading(facing, headingToAngle(facing, h))).toBe(h);
  });
  it("turn to a point faces it; turn to a heading rotates by that heading; both take no steps", () => {
    expect(resolveTurn(0, { x: 0, z: 0 }, { to: { x: 0, z: 5 } })).toBeCloseTo(Math.PI / 2, 9);
    expect(resolveTurn(1, { x: 0, z: 0 }, { heading: "left" })).toBeCloseTo(1 + Math.PI / 2, 9);
    expect(resolveTurn(0.4, { x: 3, z: 3 }, { to: { x: 3, z: 3 } })).toBe(0.4);
    expect(resolveTurn(0.4, { x: 0, z: 0 }, {})).toBe(0.4);
  });
  it("a heading move goes the way of the heading, relative to the facing", () => {
    const facing = Math.PI / 2;
    const r = resolveMove(fresh(), cfg, terrain, facing, { kind: "heading", angle: headingToAngle(facing, "right"), steps_left: 8, gait: "walk" });
    expect(r.body.pos.x).toBeCloseTo(8, 3);
    expect(r.body.pos.z).toBeCloseTo(0, 3);
  });
});

describe("rest and sleep", () => {
  it("rest puts an awake body to sleep and a full sleep from 100 takes 12 to 13 beats", () => {
    const { body, code } = startRest(fresh({ fatigue: 100, satiety: 100 }));
    expect(code).toBe("resting");
    expect(body.awake).toBe(false);
    let b = body, beats = 0;
    while (!b.awake && beats < 40) { b = { ...stepNeeds(b, cfg, ++beats).body, satiety: 100 }; }
    expect(beats).toBeGreaterThanOrEqual(12);
    expect(beats).toBeLessThanOrEqual(13);
    expect(b.awake).toBe(true);
    expect(b.fatigue).toBe(0);
  });
  it("a rested body that chooses to rest sleeps one beat and wakes", () => {
    const b = startRest(fresh()).body;
    expect(stepNeeds(b, cfg, 1).body.awake).toBe(true);
  });
  it("the dead cannot rest; an already sleeping body is unchanged", () => {
    const dead = fresh({ alive: false, awake: false });
    expect(startRest(dead)).toEqual({ body: dead, code: "cannot_act" });
    const asleep = fresh({ awake: false });
    expect(startRest(asleep).body).toBe(asleep);
  });
  it("is forced at fatigue 100 whatever the agent chose", () => {
    const awake = fresh({ fatigue: 99 });
    expect(stepNeeds(awake, cfg, 1).body.awake).toBe(false);
  });
});

describe("wake triggers (section 11)", () => {
  const asleep = () => fresh({ awake: false, fatigue: 60 });
  const wake = (d: Parameters<typeof wakeIfDisturbed>[3][number], b = asleep(), beat = 5) => wakeIfDisturbed(b, cfg, beat, [d]);
  it("a loud sound within 15 steps wakes; at 20 steps, or at normal volume, it does not", () => {
    expect(wake({ kind: "sound", volume: "loud", distance: 15 }).woke).toBe(true);
    expect(wake({ kind: "sound", volume: "loud", distance: 3 }).body.awake).toBe(true);
    expect(wake({ kind: "sound", volume: "loud", distance: 20 }).woke).toBe(false);
    expect(wake({ kind: "sound", volume: "normal", distance: 1 }).woke).toBe(false);
    expect(wake({ kind: "sound", volume: "whisper", distance: 1 }).woke).toBe(false);
  });
  it("being touched or struck wakes", () => {
    expect(wake({ kind: "touched" }).woke).toBe(true);
    expect(wake({ kind: "struck" }).woke).toBe(true);
  });
  it("any one qualifying disturbance is enough; none leaves the sleeper asleep", () => {
    const b = asleep();
    expect(wakeIfDisturbed(b, cfg, 5, [{ kind: "sound", volume: "normal", distance: 1 }, { kind: "touched" }]).woke).toBe(true);
    expect(wakeIfDisturbed(b, cfg, 5, []).body).toBe(b);
  });
  it("an awake or dead body is left alone", () => {
    const awake = fresh();
    expect(wakeIfDisturbed(awake, cfg, 5, [{ kind: "struck" }]).body).toBe(awake);
    const dead = fresh({ alive: false, awake: false });
    expect(wakeIfDisturbed(dead, cfg, 5, [{ kind: "struck" }]).woke).toBe(false);
  });
  it("in the last days of life the body cannot be woken", () => {
    const old = asleep();
    old.start_age_days = cfg.body.fatigue_floods_day + 0.1;
    expect(wakeIfDisturbed(old, cfg, 0, [{ kind: "struck" }]).woke).toBe(false);
  });
  it("wakesSleeper is the single rule", () => {
    expect(wakesSleeper({ kind: "sound", volume: "loud", distance: cfg.senses.wake_loud_steps }, cfg)).toBe(true);
    expect(wakesSleeper({ kind: "sound", volume: "loud", distance: cfg.senses.wake_loud_steps + 0.1 }, cfg)).toBe(false);
  });
});

describe("continuation: when the mind is asked again", () => {
  const awake = fresh();
  const mv = (c: Continuation, o: Partial<BeatObservations> = {}, b: Body = awake) => {
    if (c.act !== "move") throw new Error("not a move");
    const move = resolveMove(b, cfg, terrain, 0, c.intent);
    return stepContinuation(c, move.body, obs(o), cfg, move);
  };
  const longMove = () => moveContinuation({ kind: "toward", target: { x: 90, z: 0 }, gait: "walk" }, "thing-1");

  it("a move carries on while nothing interrupts it", () => {
    const s = mv(longMove());
    expect(s.reask).toBeNull();
    expect(s.reasons).toEqual([]);
    expect(s.next?.act).toBe("move");
    expect(s.next?.beats_run).toBe(1);
  });
  it("re-asks after at most 3 beats of one move", () => {
    let c: Continuation | null = longMove(), reasks = 0, beats = 0;
    while (c && beats < 10) { const s = mv(c); beats++; if (s.reask) { reasks++; expect(s.reask).toBe("max_beats"); } c = s.next; }
    expect(beats).toBe(cfg.actions.continuation_max_beats);
    expect(reasks).toBe(1);
  });
  it("each listed interrupt asks the mind again", () => {
    expect(mv(longMove(), { new_in_sight: true }).reask).toBe("new_in_sight");
    expect(mv(longMove(), { loudest_sound: "normal" }).reask).toBe("sound");
    expect(mv(longMove(), { loudest_sound: "loud" }).reask).toBe("sound");
    expect(mv(longMove(), { hurt: true }).reask).toBe("hurt");
    expect(mv(longMove(), { held_changed: true }).reask).toBe("held_changed");
  });
  it("a whisper does not interrupt", () => {
    expect(mv(longMove(), { loudest_sound: "whisper" }).reask).toBeNull();
  });
  it("arrival at the target asks again", () => {
    const near = moveContinuation({ kind: "toward", target: { x: 6, z: 0 }, gait: "walk" });
    expect(mv(near).reask).toBe("arrived");
    expect(mv(near).next).toBeNull();
  });
  it("finishing the steps of a heading move asks again", () => {
    const c = moveContinuation({ kind: "heading", angle: 0, steps_left: 6, gait: "walk" });
    expect(mv(c).reask).toBe("finished");
  });
  it("hitting the wall asks again as blocked", () => {
    const c = moveContinuation({ kind: "heading", angle: 0, steps_left: 30, gait: "walk" });
    const edge = fresh({ pos: { x: terrain.wall_radius_m - 2, z: 0 } });
    expect(mv(c, {}, edge).reask).toBe("blocked");
  });
  it("forced sleep ends a move: fatigue reaching 100 puts the body down and the mind is asked", () => {
    const tired = fresh({ fatigue: 99 });
    const after = stepNeeds(tired, cfg, 1).body;
    expect(after.awake).toBe(false);
    const s = stepContinuation(longMove(), after, QUIET, cfg);
    expect(s.reasons).toContain("forced_sleep");
    expect(s.next).toBeNull();
  });
  it("a dead body cannot carry on", () => {
    const s = stepContinuation(longMove(), fresh({ alive: false, awake: false }), QUIET, cfg);
    expect(s.reask).toBe("cannot_act");
    expect(s.next).toBeNull();
  });
  it("several reasons are all reported, in priority order, and the first is the cause", () => {
    const s = mv(longMove(), { hurt: true, new_in_sight: true, loudest_sound: "loud", held_changed: true });
    expect(s.reasons).toEqual(["hurt", "sound", "new_in_sight", "held_changed"]);
    expect(s.reask).toBe("hurt");
  });
  it("a heading move remembers how many steps are left", () => {
    const c = moveContinuation({ kind: "heading", angle: 0, steps_left: 20, gait: "walk" });
    const s = mv(c);
    expect(s.reask).toBeNull();
    expect(s.next?.act === "move" && s.next.intent.kind === "heading" && s.next.intent.steps_left).toBe(12);
  });
  it("a moving target can be re-resolved each beat", () => {
    const c = retarget(longMove(), { x: 40, z: 5 });
    expect(c.act === "move" && c.intent.kind === "toward" && c.intent.target).toEqual({ x: 40, z: 5 });
    const h = moveContinuation(heading(5));
    expect(retarget(h, { x: 1, z: 1 })).toBe(h);
  });

  it("wait runs for the beats asked, not capped at 3, and is cut short by an interrupt", () => {
    let c: Continuation | null = waitContinuation(5), beats = 0, last = null as string | null;
    while (c && beats < 10) { const s = stepContinuation(c, awake, QUIET, cfg); beats++; last = s.reask; c = s.next; }
    expect(beats).toBe(5);
    expect(last).toBe("finished");
    expect(stepContinuation(waitContinuation(5), awake, obs({ new_in_sight: true }), cfg).reask).toBe("new_in_sight");
  });
  it("rest is never capped and never re-asks while the body is still asleep", () => {
    let c: Continuation | null = restContinuation();
    const sleeper = fresh({ awake: false, fatigue: 100 });
    for (let i = 0; i < 20; i++) {
      const s = stepContinuation(c!, sleeper, obs({ new_in_sight: true, loudest_sound: "normal" }), cfg);
      expect(s.reask).toBeNull();
      c = s.next;
    }
    expect(c?.beats_run).toBe(20);
  });
  it("rest ends when the body wakes, whether rested or disturbed", () => {
    const s = stepContinuation(restContinuation(), fresh({ awake: true }), QUIET, cfg);
    expect(s.reask).toBe("woke");
    expect(s.next).toBeNull();
    const woken = wakeIfDisturbed(fresh({ awake: false, fatigue: 60 }), cfg, 5, [{ kind: "struck" }]).body;
    expect(stepContinuation(restContinuation(), woken, obs({ hurt: true }), cfg).reask).toBe("woke");
  });
  it("drag follows the same beat cap as a move", () => {
    let c: Continuation | null = dragContinuation(), beats = 0;
    while (c && beats < 10) { c = stepContinuation(c, awake, QUIET, cfg).next; beats++; }
    expect(beats).toBe(cfg.actions.continuation_max_beats);
  });
});

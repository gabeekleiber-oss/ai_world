import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "@ai-world/shared/node";
import { addCarried, ageDays, clockAt, createWorld, eatCarried, makeBush, pickFrom, spoilCarried, stepBush, stepNeeds, stepPassive, vigor, type Body } from "../src";

const cfg = loadConfig(resolve(__dirname, "../../.."));
const base = (): Body => createWorld(cfg).bodies[0]!;
const run = (b: Body, from: number, beats: number) => { let body = b, died = null as string | null, n = 0; for (; n < beats && !died; n++) { const r = stepNeeds(body, cfg, from + n + 1); body = r.body; died = r.died; } return { body, died, n }; };

describe("clock", () => {
  it("maps beats to day and light phase", () => {
    expect(clockAt(0, cfg.time).phase).toBe("dawn"); expect(clockAt(10, cfg.time).phase).toBe("day");
    expect(clockAt(25, cfg.time).phase).toBe("dusk"); expect(clockAt(30, cfg.time).isNight).toBe(true);
    expect(clockAt(85, cfg.time)).toMatchObject({ day: 2, beatOfDay: 5 });
  });
});

describe("needs", () => {
  it("starvation from full satiety takes about 3.3 days (design intent)", () => {
    const { died, n } = run({ ...base(), satiety: 100, start_age_days: 15 }, 0, 400);
    expect(died).toBe("starvation");
    expect(n / cfg.time.beats_per_day).toBeGreaterThan(3.1); expect(n / cfg.time.beats_per_day).toBeLessThan(3.5);
  });
  it("an agent that needs sleep roughly every 2.5 days is forced to sleep, then wakes rested", () => {
    let b: Body = { ...base(), satiety: 100, start_age_days: 15 }, slept = -1, woke = -1;
    for (let beat = 1; beat <= 130; beat++) { b = { ...stepNeeds(b, cfg, beat).body, satiety: 100 }; if (!b.awake && slept < 0) slept = beat; if (slept > 0 && b.awake && woke < 0) woke = beat; }
    expect(slept).toBe(100); expect(woke - slept).toBeLessThanOrEqual(14); expect(woke - slept).toBeGreaterThanOrEqual(12);
  });
  it("heals slowly when fed, not when starving", () => {
    const hurt = { ...base(), health: 50, satiety: 90, start_age_days: 15 };
    expect(stepNeeds(hurt, cfg, 1).body.health).toBeCloseTo(50.2, 3);
    expect(stepNeeds({ ...hurt, satiety: 0 }, cfg, 1).body.health).toBeCloseTo(48, 3);
  });
  it("vigor is flat to day 60, then falls to 0.6 at day 100", () => {
    expect(vigor(30, cfg)).toBe(1); expect(vigor(60, cfg)).toBe(1); expect(vigor(80, cfg)).toBeCloseTo(0.8, 6); expect(vigor(100, cfg)).toBeCloseTo(0.6, 6);
  });
  it("old age: the body lies down at day 98 and dies at day 100", () => {
    const old = { ...base(), satiety: 100, start_age_days: 97.9 };
    const { body, died, n } = run(old, 0, 400);
    expect(died).toBe("age"); expect(body.alive).toBe(false); expect(body.death?.cause).toBe("age");
    expect(ageDays(old, n, 40)).toBeGreaterThanOrEqual(100);
    expect(stepNeeds({ ...old, satiety: 100 }, cfg, 5).body.awake).toBe(false);
  });
  it("a dead body does not change", () => {
    const dead = { ...base(), alive: false };
    expect(stepNeeds(dead, cfg, 1).body).toBe(dead);
  });
});

describe("berries", () => {
  it("regrows one per 10 beats up to capacity", () => {
    let b = { ...makeBush("b", { x: 0, z: 0 }, cfg), berries: 5 };
    for (let beat = 1; beat <= 30; beat++) b = stepBush(b, beat, cfg);
    expect(b.berries).toBe(8);
    for (let beat = 31; beat <= 500; beat++) b = stepBush(b, beat, cfg);
    expect(b.berries).toBe(cfg.world.bush_capacity);
  });
  it("a stripped bush is dormant 20 beats, then regrows at half rate for 40", () => {
    let b = { ...makeBush("b", { x: 0, z: 0 }, cfg), berries: 1 };
    b = pickFrom(b, 100, cfg)!; expect(b.berries).toBe(0); expect(b.phase).toBe("dormant");
    for (let beat = 101; beat <= 119; beat++) b = stepBush(b, beat, cfg);
    expect(b.berries).toBe(0);
    for (let beat = 120; beat <= 160; beat++) b = stepBush(b, beat, cfg);
    expect(b.berries).toBe(2); // half rate: one per 20 beats
    expect(pickFrom({ ...b, berries: 0 }, 1, cfg)).toBeNull();
  });
  it("hands hold six; berries spoil after 60 beats; eating adds 12 satiety capped at 100", () => {
    let body: Body = { ...base(), satiety: 40 };
    for (let i = 0; i < 6; i++) body = addCarried(body, 10 + i, cfg)!;
    expect(addCarried(body, 20, cfg)).toBeNull();
    expect(spoilCarried(body, 69, cfg).spoiled).toBe(0);
    expect(spoilCarried(body, 70, cfg).spoiled).toBe(1);
    const ate = eatCarried(body, cfg)!; expect(ate.satiety).toBe(52); expect(ate.carried).toHaveLength(5);
    expect(eatCarried({ ...body, satiety: 95 }, cfg)!.satiety).toBe(100);
    expect(eatCarried({ ...body, carried: [] }, cfg)).toBeNull();
  });
});

describe("passive world step", () => {
  it("four idle bodies starve on schedule and the step is deterministic", () => {
    const go = () => { let w = createWorld(cfg); const deaths: Array<{ id: string; cause: string; beat: number }> = []; for (let i = 0; i < 400; i++) { const r = stepPassive(w, cfg); w = r.world; deaths.push(...r.deaths); } return { w, deaths }; };
    const a = go(), b = go();
    expect(a.deaths).toEqual(b.deaths);
    expect(a.deaths.filter((d) => d.cause === "starvation").length).toBe(4);
    expect(a.w.bodies.every((x) => !x.alive)).toBe(true);
  });
});

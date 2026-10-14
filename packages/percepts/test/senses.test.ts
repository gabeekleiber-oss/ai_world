import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "@ai-world/shared/node";
import type { Vec2 } from "@ai-world/shared";
import {
  bearingOf, hear, hearStone, inFieldOfView, isClearOf, lineClear, relativeAngle, roundSteps, sight, terrainClear, visionRadius, whisperRecipient,
  type Enclosure, type SenseWorld,
} from "../src/senses";

const { senses: cfg } = loadConfig(resolve(__dirname, "../../.."));
const P = (x: number, z: number): Vec2 => ({ x, z });
const deg = (d: number) => (d * Math.PI) / 180;
/** A point `r` metres from `from` at `degLeft` degrees to the left of facing 0. */
const at = (from: Vec2, r: number, degLeft: number): Vec2 => P(from.x + r * Math.cos(deg(degLeft)), from.z + r * Math.sin(deg(degLeft)));

const flat: SenseWorld = { heightAt: () => 0 };
const hall: Enclosure = { id: "hall", shape: { kind: "rect", center: P(0, 0), half_w: 7, half_d: 5 }, opening: { center: P(7, 0), half_width_m: 2 } };
const cave: Enclosure = { id: "cave", shape: { kind: "disc", center: P(60, 0), radius: 8 }, opening: { center: P(52, 0), half_width_m: 1.5 } };
const origin = P(0, 0);

describe("distance rounding (section 7)", () => {
  it("rounds to the nearest 2 below 20 steps", () => {
    const cases: Array<[number, number]> = [[0, 0], [0.4, 0], [0.99, 0], [1, 2], [2.9, 2], [3, 4], [5, 6], [6.9, 6], [7, 8], [7.4, 8], [8, 8], [9, 10], [18.9, 18], [19, 20], [19.99, 20]];
    for (const [m, steps] of cases) expect(roundSteps(m), `${m} m`).toBe(steps);
  });
  it("rounds to the nearest 5 from 20 steps up", () => {
    const cases: Array<[number, number]> = [[20, 20], [22.4, 20], [22.5, 25], [27.4, 25], [27.5, 30], [30, 30], [42, 40], [43, 45], [99.9, 100], [157, 155]];
    for (const [m, steps] of cases) expect(roundSteps(m), `${m} m`).toBe(steps);
  });
  it("is monotonic, and always even below 20 and a multiple of 5 from 20", () => {
    let last = 0;
    for (let m = 0; m <= 200; m += 0.1) {
      const s = roundSteps(m);
      expect(s).toBeGreaterThanOrEqual(last);
      if (m < 20 - 1e-9) expect(s % 2).toBe(0); else expect(s % 5).toBe(0);
      last = s;
    }
  });
  it("rejects distances that make no sense", () => {
    expect(() => roundSteps(-1)).toThrow();
    expect(() => roundSteps(Number.NaN)).toThrow();
    expect(() => roundSteps(Infinity)).toThrow();
  });
});

describe("egocentric bearings (section 7)", () => {
  it("names the eight headings relative to the facing, with left a positive turn", () => {
    const want: Array<[number, string]> = [[0, "ahead"], [45, "ahead-left"], [90, "left"], [135, "behind-left"], [180, "behind"], [-135, "behind-right"], [-90, "right"], [-45, "ahead-right"]];
    for (const [d, h] of want) expect(bearingOf(origin, 0, at(origin, 10, d)), `${d} deg`).toBe(h);
  });
  it("turns with the facing: the same point reads differently when the agent faces another way", () => {
    const target = P(0, 10);
    expect(bearingOf(origin, 0, target)).toBe("left");
    expect(bearingOf(origin, deg(90), target)).toBe("ahead");
    expect(bearingOf(origin, deg(180), target)).toBe("right");
    expect(bearingOf(origin, deg(-90), target)).toBe("behind");
  });
  it("matches the sim's convention: (0, +z) is to the left of facing 0", () => {
    expect(relativeAngle(origin, 0, P(0, 5))).toBeCloseTo(Math.PI / 2, 9);
  });
  it("a point on the spot reads as ahead", () => {
    expect(bearingOf(P(3, 3), 1, P(3, 3))).toBe("ahead");
  });
});

describe("sight: radius by light (section 7)", () => {
  it("sees 30 steps by day and 8 by night", () => {
    expect(visionRadius(cfg, false)).toBe(30);
    expect(visionRadius(cfg, true)).toBe(8);
    expect(sight(cfg, flat, origin, 0, P(30, 0), { isNight: false }).visible).toBe(true);
    expect(sight(cfg, flat, origin, 0, P(30.1, 0), { isNight: false }).visible).toBe(false);
    expect(sight(cfg, flat, origin, 0, P(8, 0), { isNight: true }).visible).toBe(true);
    expect(sight(cfg, flat, origin, 0, P(8.1, 0), { isNight: true }).visible).toBe(false);
    expect(sight(cfg, flat, origin, 0, P(20, 0), { isNight: true }).visible).toBe(false);
  });
});

describe("sight: the 200 degree cone (section 7)", () => {
  it("sees out to 100 degrees either side of the facing, and not beyond", () => {
    expect(inFieldOfView(cfg, origin, 0, at(origin, 10, 99))).toBe(true);
    expect(inFieldOfView(cfg, origin, 0, at(origin, 10, 101))).toBe(false);
    expect(inFieldOfView(cfg, origin, 0, at(origin, 10, -99))).toBe(true);
    expect(inFieldOfView(cfg, origin, 0, at(origin, 10, -101))).toBe(false);
    expect(inFieldOfView(cfg, origin, 0, at(origin, 10, 180))).toBe(false);
  });
  it("sees all round within 3 steps, and only the cone just beyond", () => {
    expect(sight(cfg, flat, origin, 0, at(origin, 3, 180), { isNight: false }).visible).toBe(true);
    expect(sight(cfg, flat, origin, 0, at(origin, 2.9, 135), { isNight: false }).visible).toBe(true);
    expect(sight(cfg, flat, origin, 0, at(origin, 3.1, 180), { isNight: false }).visible).toBe(false);
  });
  it("uses the same cone at night", () => {
    expect(sight(cfg, flat, origin, 0, at(origin, 6, 90), { isNight: true }).visible).toBe(true);
    expect(sight(cfg, flat, origin, 0, at(origin, 6, 150), { isNight: true }).visible).toBe(false);
    expect(sight(cfg, flat, origin, 0, at(origin, 2, 150), { isNight: true }).visible).toBe(true);
  });
  it("follows the facing", () => {
    const behind = P(-10, 0);
    expect(sight(cfg, flat, origin, 0, behind, { isNight: false }).visible).toBe(false);
    expect(sight(cfg, flat, origin, Math.PI, behind, { isNight: false }).visible).toBe(true);
  });
});

describe("sight: where it appears", () => {
  it("reports a rounded distance and an egocentric bearing, and keeps the exact distance for the engine", () => {
    const s = sight(cfg, flat, origin, 0, at(origin, 8.3, 45), { isNight: false });
    expect(s).toMatchObject({ visible: true, steps: 8, bearing: "ahead-left" });
    expect(s.distance_m).toBeCloseTo(8.3, 9);
    expect(sight(cfg, flat, origin, 0, P(27, 0), { isNight: false }).steps).toBe(25);
  });
});

describe("sight: terrain occlusion (section 7)", () => {
  const ridge = (h: number): SenseWorld => ({ heightAt: (x) => (x >= 14 && x <= 16 ? h : 0) });
  it("a ridge between hides what is behind it", () => {
    expect(sight(cfg, ridge(5), origin, 0, P(30, 0), { isNight: false }).visible).toBe(false);
    expect(terrainClear(ridge(5), origin, P(30, 0))).toBe(false);
  });
  it("a low rise below the line of the eyes does not", () => {
    expect(sight(cfg, ridge(0.3), origin, 0, P(30, 0), { isNight: false }).visible).toBe(true);
  });
  it("a hollow behind a small rise cannot be seen into, but its near edge can", () => {
    const hollow: SenseWorld = { heightAt: (x) => (x >= 14 && x <= 16 ? 1 : x > 20 ? -3 : 0) };
    expect(sight(cfg, hollow, origin, 0, P(28, 0), { isNight: false }).visible).toBe(false);
    expect(sight(cfg, hollow, origin, 0, P(10, 0), { isNight: false }).visible).toBe(true);
  });
  it("rising ground does not hide a point on it", () => {
    const slope: SenseWorld = { heightAt: (x) => 0.1 * x };
    expect(sight(cfg, slope, origin, 0, P(20, 0), { isNight: false }).visible).toBe(true);
  });
  it("a low target (like a bush) sits lower behind the same rise", () => {
    const rise = ridge(1.2);
    expect(terrainClear(rise, origin, P(30, 0), 1.0)).toBe(true);
    expect(terrainClear(rise, origin, P(30, 0), 0.1)).toBe(false);
  });
  it("looking along a line is symmetric about the ridge", () => {
    expect(terrainClear(ridge(5), P(30, 0), origin)).toBe(false);
  });
});

describe("sight: hall walls, unless inside (section 7)", () => {
  const world: SenseWorld = { heightAt: () => 0, enclosures: [hall] };
  const see = (from: Vec2, facing: number, to: Vec2) => sight(cfg, world, from, facing, to, { isNight: false }).visible;
  it("two agents inside the hall see each other", () => {
    expect(see(P(-5, 3), 0, P(5, -3))).toBe(true);
  });
  it("an agent outside cannot see through the wall", () => {
    expect(see(P(-12, 0), 0, P(-3, 0))).toBe(false);   // west wall has no opening
    expect(see(P(0, 10), -Math.PI / 2, P(0, 1))).toBe(false); // north (+z) wall
  });
  it("sees in and out through the opening, and not past its edge", () => {
    expect(see(P(14, 0), Math.PI, P(3, 0))).toBe(true);
    expect(see(P(3, 0), 0, P(14, 0))).toBe(true);
    expect(see(P(14, 6), Math.PI, P(3, 0))).toBe(false);  // crosses the east wall at z = 3.3, outside the 2 m gap
  });
  it("cannot see across the hall from one side to the other", () => {
    expect(see(P(-12, 0), 0, P(14, 0))).toBe(false);
  });
  it("sees past the hall when the line does not touch it", () => {
    expect(see(P(-12, 8), 0, P(14, 8))).toBe(true);
  });
});

describe("sight: cave rock (section 7)", () => {
  const world: SenseWorld = { heightAt: () => 0, enclosures: [cave] };
  const see = (from: Vec2, facing: number, to: Vec2) => sight(cfg, world, from, facing, to, { isNight: false }).visible;
  it("hides the inside from outside except through the mouth", () => {
    expect(see(P(40, 5), 0, P(60, 0))).toBe(false);
    expect(see(P(40, 0), 0, P(56, 0))).toBe(true);
  });
  it("lets an agent inside see the way out and nothing through the rock", () => {
    expect(see(P(58, 0), Math.PI, P(45, 0))).toBe(true);
    expect(see(P(58, 0), 0, P(75, 0))).toBe(false);
  });
});

describe("enclosure geometry", () => {
  it("an enclosure with no opening is closed to anything crossing it", () => {
    const solid: Enclosure = { id: "x", shape: hall.shape };
    expect(isClearOf(solid, P(3, 0), P(14, 0))).toBe(false);
    expect(isClearOf(solid, P(-3, 0), P(3, 0))).toBe(true);
  });
  it("no enclosures means a clear line", () => {
    expect(lineClear(undefined, origin, P(5, 5))).toBe(true);
    expect(lineClear([], origin, P(5, 5))).toBe(true);
  });
  it("every enclosure must be clear, not just one", () => {
    expect(lineClear([hall, cave], P(-12, 0), P(-3, 0))).toBe(false);
    expect(lineClear([hall, cave], P(14, 0), P(40, 0))).toBe(true);
  });
  it("a vertical and a horizontal line through the hall behave the same way", () => {
    expect(lineClear([hall], P(0, 10), P(0, -10))).toBe(false);
    expect(lineClear([hall], P(-12, 0), P(12, 0))).toBe(false);
  });
});

describe("hearing: radius by volume (section 7)", () => {
  const h = (d: number, v: "whisper" | "normal" | "loud") => hear(cfg, undefined, origin, P(d, 0), v);
  it("a whisper carries 2 steps, normal speech 12, a shout 35", () => {
    expect(h(2, "whisper").heard).toBe(true);
    expect(h(2.1, "whisper").heard).toBe(false);
    expect(h(12, "normal").heard).toBe(true);
    expect(h(12.1, "normal").heard).toBe(false);
    expect(h(35, "loud").heard).toBe(true);
    expect(h(35.1, "loud").heard).toBe(false);
  });
  it("a clear line is not muffled, and hearing needs no facing", () => {
    expect(h(10, "normal")).toMatchObject({ heard: true, muffled: false });
    expect(hear(cfg, undefined, P(10, 0), origin, "normal").heard).toBe(true);
  });
  it("reports the exact distance for the engine", () => {
    expect(h(7, "normal").distance_m).toBe(7);
  });
});

describe("hearing: doorways and walls (section 7)", () => {
  it("speech passes an open doorway clearly", () => {
    expect(hear(cfg, [hall], P(3, 0), P(12, 0), "normal")).toMatchObject({ heard: true, muffled: false });
  });
  it("speech through a wall is heard muffled, within the same radius", () => {
    expect(hear(cfg, [hall], P(-3, 0), P(-10, 0), "normal")).toMatchObject({ heard: true, muffled: true });
    expect(hear(cfg, [hall], P(-3, 0), P(-20, 0), "normal").heard).toBe(false);
    expect(hear(cfg, [hall], P(-3, 0), P(-30, 0), "loud")).toMatchObject({ heard: true, muffled: true });
  });
  it("a whisper is not heard through a wall", () => {
    expect(hear(cfg, [hall], P(-6, 0), P(-8, 0), "whisper").heard).toBe(false);
  });
  it("two inside the hall hear each other clearly", () => {
    expect(hear(cfg, [hall], P(-5, 0), P(5, 0), "normal")).toMatchObject({ heard: true, muffled: false });
  });
});

describe("hearing: the speaking stone (section 7)", () => {
  it("fills the hall wherever the listener stands inside it", () => {
    expect(hearStone(cfg, hall, P(-6.9, 4.9))).toBe(true);
    expect(hearStone(cfg, hall, P(6.9, -4.9))).toBe(true);
  });
  it("carries 20 steps outside the doorway, and no further", () => {
    expect(hearStone(cfg, hall, P(27, 0))).toBe(true);
    expect(hearStone(cfg, hall, P(27.1, 0))).toBe(false);
    expect(hearStone(cfg, hall, P(7, 19))).toBe(true);
  });
  it("measures the outdoor reach from the doorway, not from the stone or the hall centre", () => {
    expect(hearStone(cfg, hall, P(7, -19.9))).toBe(true);
    expect(hearStone(cfg, hall, P(-14, 0))).toBe(false); // 21 steps from the doorway, though only 7 from the hall's west wall
  });
  it("a hall with no opening is heard only from inside", () => {
    const closed: Enclosure = { id: "h", shape: hall.shape };
    expect(hearStone(cfg, closed, P(8, 0))).toBe(false);
    expect(hearStone(cfg, closed, P(0, 0))).toBe(true);
  });
});

describe("hearing: who hears a whisper (section 7)", () => {
  const near = { id: "mind-2", pos: P(1, 0) }, nearer = { id: "mind-3", pos: P(0.5, 0) }, far = { id: "mind-4", pos: P(5, 0) };
  it("goes to the one addressed, if in range", () => {
    expect(whisperRecipient(cfg, undefined, origin, [near, nearer, far], "mind-2")).toBe("mind-2");
  });
  it("is lost if the one addressed is out of range, even with others near", () => {
    expect(whisperRecipient(cfg, undefined, origin, [near, nearer, far], "mind-4")).toBeNull();
  });
  it("goes to the nearest within range when nobody is addressed", () => {
    expect(whisperRecipient(cfg, undefined, origin, [near, nearer, far])).toBe("mind-3");
  });
  it("is heard by nobody when nobody is within 2 steps", () => {
    expect(whisperRecipient(cfg, undefined, origin, [far])).toBeNull();
    expect(whisperRecipient(cfg, undefined, origin, [])).toBeNull();
  });
  it("ties go to the lowest id whatever the order", () => {
    const a = { id: "mind-2", pos: P(1, 0) }, b = { id: "mind-3", pos: P(-1, 0) };
    expect(whisperRecipient(cfg, undefined, origin, [a, b])).toBe("mind-2");
    expect(whisperRecipient(cfg, undefined, origin, [b, a])).toBe("mind-2");
  });
  it("is not carried through a wall", () => {
    expect(whisperRecipient(cfg, [hall], P(-6.5, 0), [{ id: "mind-2", pos: P(-8, 0) }])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "@ai-world/shared/node";
import { dist, generateLayout, heightAt, inCliffZone, isWalkable } from "../src";

const root = resolve(__dirname, "../../..");
const cfgFor = (seed: number) => loadConfig(root, { run: { seed } });

describe("terrain", () => {
  it("is deterministic, a bowl with cliffs at the rim", () => {
    const { terrain } = generateLayout(cfgFor(3));
    expect(heightAt(terrain, 10, 20)).toBe(heightAt(terrain, 10, 20));
    expect(heightAt(terrain, terrain.radius_m * 0.95, 0)).toBeGreaterThan(heightAt(terrain, 0, 0) + 15);
  });
});

describe("layout rules (DESIGN.md section 5), 200 seeds", () => {
  it("every seed satisfies every placement rule", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const cfg = cfgFor(seed), L = generateLayout(cfg), w = cfg.world, sight = cfg.senses.vision_day_steps;
      const hall = L.hall.center, cave = L.cave.mouth;
      expect(isWalkable(L.terrain, hall), `hall walkable ${seed}`).toBe(true);
      expect(Math.hypot(hall.x, hall.z), `hall near centre ${seed}`).toBeLessThanOrEqual(12);
      expect(dist(hall, cave)).toBeGreaterThanOrEqual(w.cave_dist_from_hall_m[0]); expect(dist(hall, cave)).toBeLessThanOrEqual(w.cave_dist_from_hall_m[1]);
      expect(inCliffZone(L.terrain, cave), `cave in cliff ${seed}`).toBe(true);
      expect(L.bushes).toHaveLength(w.bush_count);
      for (const b of L.bushes) {
        expect(dist(b.pos, hall)).toBeGreaterThanOrEqual(w.bush_dist_from_hall_m[0]); expect(dist(b.pos, hall)).toBeLessThanOrEqual(w.bush_dist_from_hall_m[1]);
        expect(dist(b.pos, cave)).toBeGreaterThanOrEqual(w.bush_cave_clearance_m);
        expect(dist(b.pos, L.pond.center)).toBeGreaterThan(w.pond_radius_m);
      }
      expect(L.starts).toHaveLength(3);
      for (const s of L.starts) {
        expect(Math.hypot(s.x, s.z), `start on open ground ${seed}`).toBeLessThanOrEqual(L.terrain.cliff_start_m);
        for (const b of L.bushes) expect(dist(b.pos, s), `start sees bush ${seed}`).toBeGreaterThan(sight);
        expect(dist(s, hall), `start sees hall ${seed}`).toBeGreaterThan(sight);
      }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const d = dist(L.starts[i]!, L.starts[j]!); expect(d).toBeGreaterThanOrEqual(w.start_sep_m[0] - 1e-6); expect(d).toBeLessThanOrEqual(w.start_sep_m[1] + 1e-6); }
      const nearest = Math.min(...L.starts.flatMap((s) => L.bushes.map((b) => dist(b.pos, s))));
      expect(nearest, `a bush must be findable ${seed}`).toBeLessThanOrEqual(w.min_bush_near_start_m);
    }
  });
  it("same seed gives the same layout, different seeds differ", () => {
    expect(generateLayout(cfgFor(9))).toEqual(generateLayout(cfgFor(9)));
    expect(generateLayout(cfgFor(9)).hall.center).not.toEqual(generateLayout(cfgFor(10)).hall.center);
  });
});

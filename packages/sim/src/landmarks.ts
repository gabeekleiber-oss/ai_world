import type { Config } from "@ai-world/shared";
import { Rng } from "./rng";
import { dist, heightAt, inCliffZone, makeTerrain, type Terrain, type Vec2 } from "./terrain";

export interface Layout {
  terrain: Terrain;
  hall: { center: Vec2; size_m: [number, number] };
  cave: { mouth: Vec2 };
  pond: { center: Vec2; radius_m: number };
  bushes: Array<{ id: string; pos: Vec2 }>;
  /** Where the plain bodies begin, in slot order among the plain slots. */
  starts: Vec2[];
  attempt: number;
}

export class PlacementError extends Error {}

const polar = (c: Vec2, r: number, a: number): Vec2 => ({ x: c.x + r * Math.cos(a), z: c.z + r * Math.sin(a) });
const TAU = Math.PI * 2;

function placeHall(cfg: Config, terrain: Terrain, rng: Rng): Vec2 {
  let best: Vec2 | null = null, bestScore = Infinity;
  const [w, d] = cfg.world.hall_size_m;
  for (let i = 0; i < 24; i++) {
    const c = polar({ x: 0, z: 0 }, rng.range(0, 12), rng.range(0, TAU));
    const hs = [heightAt(terrain, c.x, c.z), heightAt(terrain, c.x + w / 2, c.z + d / 2), heightAt(terrain, c.x - w / 2, c.z + d / 2), heightAt(terrain, c.x + w / 2, c.z - d / 2), heightAt(terrain, c.x - w / 2, c.z - d / 2)];
    const score = Math.max(...hs) - Math.min(...hs); // flattest footprint wins
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best!;
}

function placeCave(cfg: Config, terrain: Terrain, hall: Vec2, rng: Rng): Vec2 {
  const [lo, hi] = cfg.world.cave_dist_from_hall_m;
  for (let i = 0; i < 400; i++) {
    const p = polar(hall, rng.range(lo, hi), rng.range(0, TAU));
    if (inCliffZone(terrain, p)) return p;
  }
  throw new PlacementError("no cave site in the cliff face");
}

function placePond(cfg: Config, terrain: Terrain, hall: Vec2, cave: Vec2): Vec2 {
  let best: Vec2 | null = null, bestH = Infinity;
  const limit = terrain.radius_m * 0.7;
  for (let x = -limit; x <= limit; x += 4) for (let z = -limit; z <= limit; z += 4) {
    const p = { x, z };
    if (Math.hypot(x, z) > limit || dist(p, hall) < 25 || dist(p, cave) < 10) continue;
    const h = heightAt(terrain, x, z);
    if (h < bestH) { bestH = h; best = p; }
  }
  if (!best) throw new PlacementError("no pond site");
  return best;
}

function placeBushes(cfg: Config, terrain: Terrain, hall: Vec2, cave: Vec2, pond: Vec2, rng: Rng): Vec2[] {
  const w = cfg.world;
  const [dLo, dHi] = w.bush_dist_from_hall_m;
  const okBush = (p: Vec2, others: Vec2[]) => {
    const d = dist(p, hall);
    return d >= dLo && d <= dHi && Math.hypot(p.x, p.z) <= terrain.cliff_start_m && dist(p, cave) >= w.bush_cave_clearance_m && dist(p, pond) >= w.pond_radius_m + 2 && others.every((o) => dist(o, p) >= 2);
  };
  const centers: Vec2[] = [];
  for (let tries = 0; centers.length < w.bush_clusters; tries++) {
    if (tries > 2000) throw new PlacementError("could not place bush clusters");
    const c = polar(hall, rng.range(dLo, dHi), rng.range(0, TAU));
    if (okBush(c, []) && centers.every((o) => dist(o, c) >= w.cluster_min_sep_m)) centers.push(c);
  }
  const bushes: Vec2[] = [];
  for (let i = 0; i < w.bush_count; i++) {
    const c = centers[i % centers.length]!;
    let placed = false;
    for (let t = 0; t < 400 && !placed; t++) {
      const p = polar(c, rng.range(0, w.cluster_radius_m), rng.range(0, TAU));
      if (okBush(p, bushes)) { bushes.push(p); placed = true; }
    }
    if (!placed) throw new PlacementError("could not place a bush");
  }
  return bushes;
}

/** Starting positions: out of sight of every bush and the hall mouth, yet at least one bush within `min_bush_near_start_m`. */
function placeStarts(cfg: Config, terrain: Terrain, hall: Vec2, bushes: Vec2[], count: number, rng: Rng): Vec2[] {
  if (count === 0) return [];
  const w = cfg.world, sight = cfg.senses.vision_day_steps + 1;
  const hallClear = sight + w.hall_size_m[0] / 2;
  const [sLo, sHi] = w.start_sep_m;
  for (let t = 0; t < 6000; t++) {
    const centre = polar({ x: 0, z: 0 }, rng.range(0, terrain.cliff_start_m), rng.range(0, TAU));
    const side = rng.range(sLo, sHi), phase = rng.range(0, TAU);
    const ring = count === 1 ? 0 : side / (2 * Math.sin(Math.PI / count));
    const pts = Array.from({ length: count }, (_, k) => polar(centre, ring, phase + (TAU * k) / count));
    const hidden = pts.every((p) => Math.hypot(p.x, p.z) <= terrain.cliff_start_m && dist(p, hall) >= hallClear && bushes.every((b) => dist(b, p) >= sight));
    const nearest = Math.min(...pts.flatMap((p) => bushes.map((b) => dist(b, p))));
    const spaced = pts.every((p, i) => pts.every((q, j) => i === j || (dist(p, q) >= sLo && (count > 3 || dist(p, q) <= sHi))));
    if (hidden && spaced && nearest <= w.min_bush_near_start_m) return pts;
  }
  throw new PlacementError("no starting clearing");
}

/** Deterministic for a seed. Retries with a fresh sub-stream if a draw cannot satisfy the rules, recording the attempt number. */
export function generateLayout(cfg: Config): Layout {
  const plainCount = cfg.population.slots.filter((s) => s === "plain").length;
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    const rng = new Rng(cfg.run.seed, `layout-${attempt}`);
    try {
      const terrain = makeTerrain(cfg.run.seed, cfg.world);
      const hall = placeHall(cfg, terrain, rng);
      const cave = placeCave(cfg, terrain, hall, rng);
      const pond = placePond(cfg, terrain, hall, cave);
      const bushPos = placeBushes(cfg, terrain, hall, cave, pond, rng);
      const starts = placeStarts(cfg, terrain, hall, bushPos, plainCount, rng);
      return {
        terrain, hall: { center: hall, size_m: [cfg.world.hall_size_m[0], cfg.world.hall_size_m[1]] }, cave: { mouth: cave },
        pond: { center: pond, radius_m: cfg.world.pond_radius_m }, bushes: bushPos.map((pos, i) => ({ id: `bush-${i + 1}`, pos })), starts, attempt,
      };
    } catch (e) { if (!(e instanceof PlacementError)) throw e; lastError = e; }
  }
  throw new PlacementError(`layout failed for seed ${cfg.run.seed}: ${(lastError as Error).message}`);
}

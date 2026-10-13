import type { Config } from "@ai-world/shared";
import { hashString } from "./rng";

export interface Vec2 { x: number; z: number }
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Parameters only. The height field regenerates from these (terrain.json, DESIGN.md section 15). Origin is the valley centre; 1 unit = 1 m. */
export interface Terrain {
  seed: number;
  radius_m: number;
  cliff_start_m: number;
  wall_radius_m: number;
  noise_m: number;
  bowl_depth_m: number;
}

export function makeTerrain(seed: number, w: Config["world"]): Terrain {
  const radius = w.valley_size_m / 2;
  return { seed, radius_m: radius, cliff_start_m: radius * w.cliff_start_fraction, wall_radius_m: radius * w.rim_wall_fraction, noise_m: w.terrain_noise_m, bowl_depth_m: w.terrain_bowl_depth_m };
}

function lattice(seed: number, ix: number, iz: number): number {
  let h = (seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  const a = lattice(seed, ix, iz), b = lattice(seed, ix + 1, iz), c = lattice(seed, ix, iz + 1), d = lattice(seed, ix + 1, iz + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}

/** Ground height in metres: a bowl, rolling noise inside it, and steep cliffs past `cliff_start_m`. */
export function heightAt(t: Terrain, x: number, z: number): number {
  const r = Math.hypot(x, z);
  const bowl = -t.bowl_depth_m * (1 - (r / t.radius_m) ** 2);
  let n = 0, amp = 1, freq = 1 / 28, norm = 0;
  const s = t.seed ^ hashString("height");
  for (let o = 0; o < 3; o++) { n += (valueNoise(s + o, x * freq, z * freq) - 0.5) * amp; norm += amp; amp /= 2; freq *= 2; }
  const rolling = (n / norm) * 2 * t.noise_m * Math.min(1, r < t.cliff_start_m ? 1 : 0.3);
  const cliff = r > t.cliff_start_m ? (r - t.cliff_start_m) * 3.5 : 0;
  return bowl + rolling + cliff;
}

/** Inside the invisible wall at the foot of the cliffs (agents cannot leave the valley). */
export const isWalkable = (t: Terrain, p: Vec2): boolean => Math.hypot(p.x, p.z) <= t.wall_radius_m;
export const inCliffZone = (t: Terrain, p: Vec2): boolean => Math.hypot(p.x, p.z) >= t.cliff_start_m && Math.hypot(p.x, p.z) <= t.wall_radius_m;

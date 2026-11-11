import type { Vec2 } from "@ai-world/shared";
import { distance } from "./bearing";

/**
 * Occlusion geometry (DESIGN.md section 7: sight is "blocked by terrain, hall walls (unless inside), cave rock"; speech
 * passes "through open doorways, muffled through walls").
 *
 * The percepts package does not know the world's layout types, so the caller (the percept builder, PCT-05) describes the
 * hall and the cave as `Enclosure`s: a convex shape, solid all round except for one optional opening. The sim layout
 * currently records a hall centre and size and a cave mouth but no doorway direction; whoever wires the percept builder
 * decides where the opening is and passes it in. Nothing here is shown to an agent.
 */
export type Shape =
  | { kind: "rect"; center: Vec2; half_w: number; half_d: number }
  | { kind: "disc"; center: Vec2; radius: number };

/** A gap in the boundary: anything whose line crosses the boundary within `half_width_m` of `center` passes through. */
export interface Opening { center: Vec2; half_width_m: number }

export interface Enclosure { id: string; shape: Shape; opening?: Opening }

const EPS = 1e-9;

export function isInside(shape: Shape, p: Vec2): boolean {
  if (shape.kind === "disc") return distance(p, shape.center) <= shape.radius + EPS;
  return Math.abs(p.x - shape.center.x) <= shape.half_w + EPS && Math.abs(p.z - shape.center.z) <= shape.half_d + EPS;
}

/**
 * Where the infinite line a + t (b - a) is inside the shape, as a parameter interval, or null if it never is.
 * t = 0 is `a` and t = 1 is `b`. A convex shape gives a single interval.
 */
export function lineInterval(shape: Shape, a: Vec2, b: Vec2): [number, number] | null {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (shape.kind === "disc") {
    const fx = a.x - shape.center.x, fz = a.z - shape.center.z;
    const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - shape.radius * shape.radius;
    if (A < EPS) return C <= 0 ? [-Infinity, Infinity] : null;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  }
  let lo = -Infinity, hi = Infinity;
  const slab = (origin: number, delta: number, center: number, half: number): boolean => {
    if (Math.abs(delta) < EPS) return Math.abs(origin - center) <= half + EPS;
    const t1 = (center - half - origin) / delta, t2 = (center + half - origin) / delta;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    return true;
  };
  if (!slab(a.x, dx, shape.center.x, shape.half_w) || !slab(a.z, dz, shape.center.z, shape.half_d)) return null;
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Whether the walls of one enclosure stand between two points on a straight line. The line is clear when both points are
 * inside (the walls are not between them), when exactly one is inside and the line crosses the boundary within the
 * opening, or when neither is inside and the line misses the footprint. Otherwise it is blocked.
 */
export function isClearOf(enclosure: Enclosure, a: Vec2, b: Vec2): boolean {
  const { shape, opening } = enclosure;
  const aIn = isInside(shape, a), bIn = isInside(shape, b);
  if (aIn && bIn) return true;                         // both inside: the walls are not between them
  const span = lineInterval(shape, a, b);
  if (aIn !== bIn) {                                   // one inside: the line must leave or enter through the opening
    if (!opening || !span) return false;
    const t = aIn ? span[1] : span[0];                 // where the line crosses the boundary
    const crossing = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    return distance(crossing, opening.center) <= opening.half_width_m + EPS;
  }
  // neither inside: the walls block the line if it passes through the footprint at all
  return !(span && span[1] >= 0 && span[0] <= 1);
}

/** True when no enclosure's walls stand between the two points. */
export function lineClear(enclosures: readonly Enclosure[] | undefined, a: Vec2, b: Vec2): boolean {
  return !enclosures || enclosures.every((e) => isClearOf(e, a, b));
}

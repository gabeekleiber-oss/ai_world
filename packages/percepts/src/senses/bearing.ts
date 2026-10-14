import { HEADINGS, type Heading, type Vec2 } from "@ai-world/shared";

/**
 * Egocentric bearings and distance rounding (DESIGN.md section 7, "Distances and directions").
 * No compass, no coordinates, no map: an agent only ever learns a coarse heading relative to where it faces and a coarse
 * distance in whole steps (1 step = 1 m).
 *
 * Facing convention, identical to the sim package's `actions/move.ts` so a heading a mind is told is the heading it can
 * act on: an angle in radians, direction vector (cos a, sin a) over (x, z), and a positive offset from the facing is to
 * the agent's left. This package depends only on `shared`, so the convention is restated here, not imported.
 */
const TAU = Math.PI * 2;

/** Offset of each heading from the facing, in radians. Positive is left. */
export const HEADING_OFFSET: Readonly<Record<Heading, number>> = {
  ahead: 0, "ahead-left": Math.PI / 4, left: Math.PI / 2, "behind-left": (3 * Math.PI) / 4,
  behind: Math.PI, "behind-right": -(3 * Math.PI) / 4, right: -Math.PI / 2, "ahead-right": -Math.PI / 4,
};

/** Wrap an angle into (-PI, PI]. */
export function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x <= -Math.PI) x += TAU;
  return x;
}

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** The absolute angle from one point to another. */
export const angleBetween = (from: Vec2, to: Vec2): number => Math.atan2(to.z - from.z, to.x - from.x);

/** The angle of a point relative to the facing, in (-PI, PI]. Zero is straight ahead, positive is to the left. */
export const relativeAngle = (from: Vec2, facing: number, to: Vec2): number => normalizeAngle(angleBetween(from, to) - facing);

/** The nearest of the eight headings for a point seen from `from` while facing `facing`. A point on the spot reads as ahead. */
export function bearingOf(from: Vec2, facing: number, to: Vec2): Heading {
  if (distance(from, to) < 1e-9) return "ahead";
  const rel = relativeAngle(from, facing, to);
  let best: Heading = "ahead", bestGap = Infinity;
  for (const h of HEADINGS) {
    const gap = Math.abs(normalizeAngle(rel - HEADING_OFFSET[h]));
    if (gap < bestGap - 1e-12) { bestGap = gap; best = h; }
  }
  return best;
}

/** Distances below this many steps are rounded to the nearest 2; from here up, to the nearest 5 (section 7). */
export const COARSE_FROM_STEPS = 20;

/**
 * Round a distance in metres to the whole steps an agent is told: the nearest 2 below 20 steps, the nearest 5 from 20 up.
 * Halves round up, so the result is stable and never depends on floating-point luck. Under one step it reads as 0
 * (right at your feet); the percept renderer chooses the wording.
 *
 * The rounding is applied after the 20-step test on the exact distance, so 19.0 becomes 20 and 22.4 becomes 20.
 */
export function roundSteps(metres: number): number {
  if (!Number.isFinite(metres) || metres < 0) throw new Error("distance must be a finite non-negative number");
  if (metres < COARSE_FROM_STEPS) return Math.floor(metres / 2 + 0.5) * 2;
  return Math.floor(metres / 5 + 0.5) * 5;
}

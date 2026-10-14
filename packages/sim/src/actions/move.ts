import { HEADINGS, type Config, type Heading } from "@ai-world/shared";
import type { Body } from "../bodies";
import { dist, isWalkable, type Terrain, type Vec2 } from "../terrain";

/**
 * Movement and turning (DESIGN.md section 8 `move` and `turn`, section 11 movement).
 * Everything here is pure: it returns a new body and never mutates its input. Results are codes, never text; the
 * percepts package turns a code into an in-world line (section 8, validation step 5).
 *
 * Facing convention (shared with the percept package): an angle in radians, direction vector (cos a, sin a) over (x, z).
 * A positive offset from the facing is to the agent's left. Headings are egocentric (section 7), so a heading is always
 * relative to the facing, never to a compass.
 */
export type Gait = "walk" | "run";

export type MoveCode =
  | "moved"        // travelled this beat's allowance and has further to go
  | "arrived"      // reached the target (within the stop distance)
  | "finished"     // a heading move used up its steps
  | "too_steep"    // pushed against the foot of the cliffs; stopped at the invisible wall
  | "cannot_act";  // asleep, dead or otherwise unable; nothing changed

/** What the agent is trying to do. Held in the continuation between beats (see continuation.ts). */
export type MoveIntent =
  | { kind: "toward"; target: Vec2; gait: Gait; /** Stop this far from the target. Defaults to the reach in config. */ stop_within?: number }
  | { kind: "heading"; angle: number; steps_left: number; gait: Gait };

export interface MoveResult {
  body: Body;
  /** Facing after the move: the direction of travel, or unchanged if the body could not act. */
  facing: number;
  moved_steps: number;
  /** For a heading move, the steps still to go. Zero once finished or blocked. For a `toward` move, the distance still to cover. */
  steps_left: number;
  code: MoveCode;
  /** Extra fatigue charged for running this beat (the normal awake gain is applied by stepNeeds). */
  fatigue_added: number;
}

const TAU = Math.PI * 2;
const r4 = (n: number) => Math.round(n * 10000) / 10000; // keeps float drift out of the state hash (same as needs.ts)

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

/** The absolute angle of an egocentric heading, given where the agent is facing. */
export const headingToAngle = (facing: number, heading: Heading): number => normalizeAngle(facing + HEADING_OFFSET[heading]);

/** The angle from one point to another. */
export const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.z - from.z, to.x - from.x);

/** The nearest of the eight headings for an absolute angle. Used by percepts to say "ahead-left" and the like. */
export function angleToHeading(facing: number, angle: number): Heading {
  const rel = normalizeAngle(angle - facing);
  let best: Heading = "ahead", bestGap = Infinity;
  for (const h of HEADINGS) {
    const gap = Math.abs(normalizeAngle(rel - HEADING_OFFSET[h]));
    if (gap < bestGap - 1e-12) { bestGap = gap; best = h; }
  }
  return best;
}

/** `turn`: instant, takes no beat. A handle's position or a heading gives the new facing. */
export function resolveTurn(facing: number, pos: Vec2, spec: { to?: Vec2; heading?: Heading }): number {
  if (spec.to) return dist(pos, spec.to) < 1e-9 ? facing : angleTo(pos, spec.to);
  if (spec.heading) return headingToAngle(facing, spec.heading);
  return facing;
}

/** Steps a gait covers in one beat (section 11): walk 8, run 14. */
export const stepsPerBeat = (cfg: Pick<Config, "movement">, gait: Gait): number => (gait === "run" ? cfg.movement.run_steps : cfg.movement.walk_steps);

/**
 * Keep a point inside the invisible wall at the foot of the cliffs. A path that would cross it is cut where it meets it,
 * so the body ends at the wall instead of teleporting back (the percepts report "the way is too steep").
 */
export function clipToWall(terrain: Terrain, from: Vec2, to: Vec2): { pos: Vec2; clipped: boolean } {
  if (isWalkable(terrain, to)) return { pos: to, clipped: false };
  const R = terrain.wall_radius_m;
  const dx = to.x - from.x, dz = to.z - from.z;
  const a = dx * dx + dz * dz;
  let t = 0;
  if (a > 0 && isWalkable(terrain, from)) {
    const b = 2 * (from.x * dx + from.z * dz), c = from.x * from.x + from.z * from.z - R * R; // c <= 0 inside the wall
    t = Math.min(1, Math.max(0, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a)));
  }
  return { pos: settle(terrain, { x: from.x + dx * t, z: from.z + dz * t }), clipped: true };
}

/** Round to the state-hash precision, then nudge inward until rounding has not pushed the point past the wall. */
function settle(terrain: Terrain, p: Vec2): Vec2 {
  let q = { x: r4(p.x), z: r4(p.z) };
  for (let i = 0; i < 20 && !isWalkable(terrain, q); i++) q = { x: r4(q.x * 0.99999), z: r4(q.z * 0.99999) };
  return q;
}

/**
 * Resolve one beat of movement for one body. A walk covers `walk_steps`, a run `run_steps` (and costs `run_fatigue` extra
 * on top of the normal awake gain). `terrain` supplies the invisible wall. Hall walls and cave rock are not modelled here.
 */
export function resolveMove(body: Body, cfg: Config, terrain: Terrain, facing: number, intent: MoveIntent): MoveResult {
  const idle = (): MoveResult => ({ body, facing, moved_steps: 0, steps_left: 0, code: "cannot_act", fatigue_added: 0 });
  if (!body.alive || !body.awake) return idle();

  const rate = stepsPerBeat(cfg, intent.gait);
  let heading: number, allowance: number, left: number, stop = 0;
  if (intent.kind === "toward") {
    stop = intent.stop_within ?? cfg.combat.reach_steps;
    const d = dist(body.pos, intent.target);
    left = Math.max(0, d - stop);
    heading = d < 1e-9 ? facing : angleTo(body.pos, intent.target);
    allowance = Math.min(rate, left);
  } else {
    heading = intent.angle;
    left = Math.max(0, intent.steps_left);
    allowance = Math.min(rate, left);
  }

  if (allowance <= 1e-9) {
    const code: MoveCode = intent.kind === "toward" ? "arrived" : "finished";
    return { body, facing: heading, moved_steps: 0, steps_left: 0, code, fatigue_added: 0 };
  }

  const want = { x: body.pos.x + Math.cos(heading) * allowance, z: body.pos.z + Math.sin(heading) * allowance };
  const { pos, clipped } = clipToWall(terrain, body.pos, want);
  const moved = r4(dist(body.pos, pos));
  const fatigue_added = intent.gait === "run" && moved > 0 ? cfg.movement.run_fatigue : 0;
  const next: Body = { ...body, pos: clipped ? pos : { x: r4(pos.x), z: r4(pos.z) }, fatigue: r4(Math.min(100, body.fatigue + fatigue_added)) };

  if (clipped) return { body: next, facing: heading, moved_steps: moved, steps_left: 0, code: "too_steep", fatigue_added };
  const remaining = r4(left - allowance);
  const code: MoveCode = remaining <= 1e-9 ? (intent.kind === "toward" ? "arrived" : "finished") : "moved";
  return { body: next, facing: heading, moved_steps: r4(allowance), steps_left: code === "moved" ? remaining : 0, code, fatigue_added };
}

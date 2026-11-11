import type { Config, Heading } from "@ai-world/shared";
import { HEADINGS } from "@ai-world/shared";
import type { Body } from "../bodies";
import { dist, inCliffZone, type Terrain, type Vec2 } from "../terrain";

/** DESIGN.md sections 8 and 11. One step is one metre. Handles are resolved by the percepts layer before this runs. */
export type Gait = "walk" | "run" | "drag";

/** Steps per beat for a gait (section 11: walk 8, run 14, drag 3). */
export function speedFor(gait: Gait, cfg: Config): number {
  return gait === "run" ? cfg.movement.run_steps : gait === "drag" ? cfg.movement.drag_steps : cfg.movement.walk_steps;
}

/** The soft boundary: the steep ground past the cliff line costs twice as many steps to cross. The wall at the foot stops all movement. */
export const CLIFF_STEP_COST = 2;

export interface MoveOrder {
  gait: Gait;
  /** Go toward a resolved position (a thing, a place, another body). */
  target?: Vec2;
  /** Or go along a unit direction for `stepsLeft` steps (a heading order). */
  dir?: Vec2;
  stepsLeft?: number;
  /** A target order ends once the body is this close. */
  arrive_within: number;
}

export interface MoveResult {
  body: Body;
  order: MoveOrder | null;
  from: Vec2;
  to: Vec2;
  moved: number;
  arrived: boolean;
  /** The wall at the foot of the cliffs stopped the body. */
  blocked: boolean;
  /** The run pushed fatigue to 100 and the body lay down. */
  forced_sleep: boolean;
}

const EPS = 1e-9;
const SUB = 0.5;

/** Convert a relative heading to a world unit vector, given the body's facing (unit vector). `ahead` is the facing itself. */
export function headingToVector(facing: Vec2, heading: Heading): Vec2 {
  const i = HEADINGS.indexOf(heading);
  // Viewer convention (x right, z toward the camera, y up): left of a facing is the facing rotated by -90 degrees in (x, z).
  const a = Math.atan2(facing.z, facing.x) - (i * Math.PI) / 4;
  return { x: Math.cos(a), z: Math.sin(a) };
}

export function directionTo(from: Vec2, to: Vec2): Vec2 | null {
  const d = dist(from, to);
  return d < EPS ? null : { x: (to.x - from.x) / d, z: (to.z - from.z) / d };
}

/** Lie down if fatigue has reached 100 (forced sleep, section 11). Pure. */
export function enforceFatigueCeiling(body: Body): { body: Body; forced: boolean } {
  if (body.alive && body.awake && body.fatigue >= 100) return { body: { ...body, fatigue: 100, awake: false }, forced: true };
  return { body, forced: false };
}

/**
 * Advance one body by one beat of a move order. Pure.
 * Only an awake, living body moves. Run costs `run_fatigue` for any beat in which the body actually moved.
 * Steps are spent one half-metre at a time so the cliff zone costs more and the wall at the foot cannot be crossed.
 */
export function stepMove(body: Body, order: MoveOrder, terrain: Terrain, cfg: Config): MoveResult {
  const from = body.pos;
  const idle: MoveResult = { body, order, from, to: from, moved: 0, arrived: false, blocked: false, forced_sleep: false };
  if (!body.alive || !body.awake) return idle;

  let pos = { ...body.pos };
  let budget = speedFor(order.gait, cfg);
  let moved = 0, blocked = false, arrived = false;
  let stepsLeft = order.stepsLeft;

  const toTarget = () => (order.target ? directionTo(pos, order.target) : null);
  if (order.target && dist(pos, order.target) <= order.arrive_within) arrived = true;

  while (!arrived && budget > EPS) {
    let dir: Vec2 | null;
    let room: number; // distance left on the order
    if (order.target) {
      dir = toTarget();
      room = Math.max(0, dist(pos, order.target) - order.arrive_within);
    } else {
      dir = order.dir ?? null;
      room = stepsLeft ?? 0;
    }
    if (!dir || room <= EPS) { arrived = true; break; }

    const cost = inCliffZone(terrain, pos) ? CLIFF_STEP_COST : 1;
    const len = Math.min(SUB, room, budget / cost);
    const next = { x: pos.x + dir.x * len, z: pos.z + dir.z * len };
    const r = Math.hypot(next.x, next.z);
    if (r > terrain.wall_radius_m) {
      const along = Math.max(0, terrain.wall_radius_m - Math.hypot(pos.x, pos.z));
      if (along > EPS) { pos = { x: pos.x + (dir.x * along), z: pos.z + (dir.z * along) }; moved += along; }
      blocked = true; break;
    }
    pos = next; moved += len; budget -= len * cost;
    if (!order.target && stepsLeft !== undefined) stepsLeft -= len;
  }

  if (!order.target && stepsLeft !== undefined && stepsLeft <= EPS) arrived = true;
  if (order.target && dist(pos, order.target) <= order.arrive_within + EPS) arrived = true;

  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  let out: Body = { ...body, pos: { x: r4(pos.x), z: r4(pos.z) } };
  if (order.gait === "run" && moved > EPS) out = { ...out, fatigue: r4(Math.min(100, out.fatigue + cfg.movement.run_fatigue)) };
  const f = enforceFatigueCeiling(out);
  const next: MoveOrder | null = arrived || blocked || f.forced ? null : { ...order, stepsLeft };
  return { body: f.body, order: next, from, to: f.body.pos, moved: r4(moved), arrived, blocked, forced_sleep: f.forced };
}

/** Build an order from a decision's `move` action once the target has been resolved. */
export function makeMoveOrder(a: { gait?: "walk" | "run"; steps?: number }, cfg: Config, opts: { target?: Vec2; dir?: Vec2; arrive_within?: number }): MoveOrder {
  const steps = a.steps === undefined ? undefined : Math.min(a.steps, cfg.movement.move_max_steps);
  return { gait: a.gait ?? "walk", target: opts.target, dir: opts.dir, stepsLeft: opts.target ? undefined : steps, arrive_within: opts.arrive_within ?? 1.5 };
}

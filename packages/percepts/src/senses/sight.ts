import type { Config, Heading, Vec2 } from "@ai-world/shared";
import { bearingOf, distance, relativeAngle, roundSteps } from "./bearing";
import { lineClear, type Enclosure } from "./geometry";

/**
 * Sight (DESIGN.md section 7, sensing table): 30 steps by day and 8 by night, a 200 degree forward cone, a full circle
 * within 3 steps, blocked by terrain, hall walls (unless inside) and cave rock.
 *
 * Pure geometry over positions. Which things exist, how they are described and the handles they get belong to the
 * percept builder; this module answers only "can this point be seen from that one, and where does it appear".
 */
export type SightConfig = Pick<Config["senses"], "vision_day_steps" | "vision_night_steps" | "vision_close_steps" | "vision_cone_degrees">;

/** What the sight line can run into. `heightAt` is the ground height in metres; `enclosures` are the hall and the cave. */
export interface SenseWorld {
  heightAt(x: number, z: number): number;
  enclosures?: readonly Enclosure[];
}

/** Height of an agent's eyes above its feet, in metres. A physical constant of the line-of-sight model, not a tunable. */
export const EYE_HEIGHT_M = 1.6;
/** Default height of the point looked at: roughly the middle of a body. Pass `target_height_m` for lower or taller things. */
export const DEFAULT_TARGET_HEIGHT_M = 1.0;
/** Spacing of terrain samples along a sight line, in metres. Ridges narrower than this can be missed. */
export const TERRAIN_SAMPLE_M = 1;

export interface SightOptions {
  isNight: boolean;
  /** Height above the ground of the point looked at. */
  target_height_m?: number;
}

/** The furthest an agent can see right now (before the cone and occlusion), in steps. */
export const visionRadius = (cfg: Pick<SightConfig, "vision_day_steps" | "vision_night_steps">, isNight: boolean): number =>
  isNight ? cfg.vision_night_steps : cfg.vision_day_steps;

/** Inside the field of view: the full circle within the close radius, otherwise the forward cone around the facing. */
export function inFieldOfView(cfg: Pick<SightConfig, "vision_close_steps" | "vision_cone_degrees">, from: Vec2, facing: number, to: Vec2): boolean {
  if (distance(from, to) <= cfg.vision_close_steps) return true;
  return Math.abs(relativeAngle(from, facing, to)) <= ((cfg.vision_cone_degrees / 2) * Math.PI) / 180 + 1e-9;
}

/** True when no ground between the two points rises above the line from the eye to the target. */
export function terrainClear(world: Pick<SenseWorld, "heightAt">, from: Vec2, to: Vec2, targetHeightM = DEFAULT_TARGET_HEIGHT_M): boolean {
  const d = distance(from, to);
  const eye = world.heightAt(from.x, from.z) + EYE_HEIGHT_M;
  const goal = world.heightAt(to.x, to.z) + targetHeightM;
  const n = Math.floor(d / TERRAIN_SAMPLE_M);
  for (let i = 1; i < n; i++) {
    const t = (i * TERRAIN_SAMPLE_M) / d;
    const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
    if (world.heightAt(x, z) > eye + (goal - eye) * t) return false;
  }
  return true;
}

export interface Sighting {
  visible: boolean;
  /** Exact distance in metres. Engine use only; agents are only ever given `steps`. */
  distance_m: number;
  /** The coarse distance an agent is told: nearest 2 below 20 steps, nearest 5 above. */
  steps: number;
  bearing: Heading;
}

/** Can an observer at `from`, facing `facing`, see the point `to`, and if so where does it appear? */
export function sight(cfg: SightConfig, world: SenseWorld, from: Vec2, facing: number, to: Vec2, opts: SightOptions): Sighting {
  const d = distance(from, to);
  const out = (visible: boolean): Sighting => ({ visible, distance_m: d, steps: roundSteps(d), bearing: bearingOf(from, facing, to) });
  if (d > visionRadius(cfg, opts.isNight)) return out(false);
  if (!inFieldOfView(cfg, from, facing, to)) return out(false);
  if (!lineClear(world.enclosures, from, to)) return out(false);
  if (!terrainClear(world, from, to, opts.target_height_m)) return out(false);
  return out(true);
}

import type { Config } from "@ai-world/shared";
import { spawnBody, type Body, type DeathCause } from "./bodies";
import { makeBush, spoilCarried, stepBush, type Bush } from "./berries";
import { stateHash } from "./hash";
import { generateLayout, type Layout } from "./landmarks";
import { stepNeeds } from "./needs";
import { Rng, type RngState } from "./rng";
import { drawMaliciousSlot } from "./temperament";

export interface World {
  schema_version: 1;
  seed: number;
  /** The beat the world is currently at. Beat 0 is dawn of day 0. */
  beat: number;
  layout: Layout;
  bushes: Bush[];
  bodies: Body[];
  next_mind_number: number;
  /** Engine-only. Which slot carries the malicious temperament. Never shown to any agent (R3). */
  malicious_slot: number | null;
  /** State of every named random stream, so a snapshot resumes exactly. */
  rng: Record<string, RngState>;
}

export function createWorld(cfg: Config): World {
  const layout = generateLayout(cfg);
  const bodiesRng = new Rng(cfg.run.seed, "bodies");
  const malicious = drawMaliciousSlot(cfg, new Rng(cfg.run.seed, "temperament"));
  let plainIndex = 0;
  const bodies = cfg.population.slots.map((kind, slot): Body => {
    let pos;
    if (kind === "plain") pos = layout.starts[plainIndex++]!;
    else {
      const [w, d] = layout.hall.size_m, c = layout.hall.center;
      pos = { x: c.x + bodiesRng.range(-(w / 2 - 1), w / 2 - 1), z: c.z + bodiesRng.range(-(d / 2 - 1), d / 2 - 1) };
    }
    return spawnBody(cfg, bodiesRng, { id: `mind-${slot + 1}`, slot, kind, malicious: malicious === slot, pos, start_age_days: cfg.population.staggered_start_ages[slot] ?? cfg.population.arrival_age, spawn_beat: 0 });
  });
  return {
    schema_version: 1, seed: cfg.run.seed, beat: 0, layout, bushes: layout.bushes.map((b) => makeBush(b.id, b.pos, cfg)), bodies,
    next_mind_number: bodies.length + 1, malicious_slot: malicious, rng: { bodies: bodiesRng.getState() },
  };
}

export interface PassiveResult { world: World; deaths: Array<{ id: string; cause: DeathCause; beat: number }> }

/** The part of a beat that needs no decisions: regrowth, spoilage, hunger, fatigue, healing, ageing (resolution order step 1). */
export function stepPassive(world: World, cfg: Config): PassiveResult {
  const beat = world.beat + 1;
  const deaths: PassiveResult["deaths"] = [];
  const bodies = world.bodies.map((b) => {
    const { body } = spoilCarried(b, beat, cfg);
    const r = stepNeeds(body, cfg, beat);
    if (r.died) deaths.push({ id: b.id, cause: r.died, beat });
    return r.body;
  });
  return { world: { ...world, beat, bushes: world.bushes.map((b) => stepBush(b, beat, cfg)), bodies }, deaths };
}

export const worldHash = (w: World): string => stateHash(w);

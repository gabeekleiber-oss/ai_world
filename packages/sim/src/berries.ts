import type { Config } from "@ai-world/shared";
import type { Body } from "./bodies";
import type { Vec2 } from "./terrain";

export interface Bush {
  id: string;
  pos: Vec2;
  berries: number;
  capacity: number;
  /** Beats since the last regrown berry (or since regrowth resumed). */
  progress: number;
  /** After a bush is stripped it is dormant, then regrows at half rate for a while (a mild commons penalty). */
  phase: "normal" | "dormant" | "half";
  phase_until: number;
}

export const makeBush = (id: string, pos: Vec2, cfg: Config): Bush => ({ id, pos, berries: cfg.world.bush_capacity, capacity: cfg.world.bush_capacity, progress: 0, phase: "normal", phase_until: 0 });

/** Advance a bush by one beat. `beat` is the beat being entered. */
export function stepBush(b: Bush, beat: number, cfg: Config): Bush {
  const w = cfg.world;
  const o: Bush = { ...b };
  if (o.phase === "dormant" && beat >= o.phase_until) { o.phase = "half"; o.phase_until = beat + w.stripped_half_rate_beats; o.progress = 0; }
  else if (o.phase === "half" && beat >= o.phase_until) { o.phase = "normal"; o.progress = 0; }
  if (o.phase === "dormant" || o.berries >= o.capacity) { o.progress = 0; return o; }
  o.progress += 1;
  const need = o.phase === "half" ? w.regrow_beats * 2 : w.regrow_beats;
  if (o.progress >= need) { o.berries += 1; o.progress = 0; }
  return o;
}

/** Take one berry. Returns null if the bush is empty. Stripping the last berry starts the dormant phase. */
export function pickFrom(b: Bush, beat: number, cfg: Config): Bush | null {
  if (b.berries <= 0) return null;
  const o: Bush = { ...b, berries: b.berries - 1 };
  if (o.berries === 0) { o.phase = "dormant"; o.phase_until = beat + cfg.world.stripped_dormant_beats; o.progress = 0; }
  return o;
}

/** A body can carry at most `carry_max` berries; returns the updated body or null if its hands are full. */
export function addCarried(body: Body, beat: number, cfg: Config): Body | null {
  if (body.carried.length >= cfg.needs.carry_max) return null;
  return { ...body, carried: [...body.carried, beat] };
}

/** Berries spoil after `spoil_beats`, so there is no permanent stockpile. Returns the body and how many spoiled. */
export function spoilCarried(body: Body, beat: number, cfg: Config): { body: Body; spoiled: number } {
  const kept = body.carried.filter((picked) => beat - picked < cfg.world.spoil_beats);
  return kept.length === body.carried.length ? { body, spoiled: 0 } : { body: { ...body, carried: kept }, spoiled: body.carried.length - kept.length };
}

/** Eat one carried berry (oldest first). Satiety is capped at 100. */
export function eatCarried(body: Body, cfg: Config): Body | null {
  if (body.carried.length === 0) return null;
  const [, ...rest] = body.carried;
  return { ...body, carried: rest, satiety: Math.min(100, body.satiety + cfg.needs.berry_value) };
}

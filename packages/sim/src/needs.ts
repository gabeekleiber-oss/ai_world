import type { Config } from "@ai-world/shared";
import { ageDays, type Body, type DeathCause } from "./bodies";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (n: number) => Math.round(n * 10000) / 10000; // keeps float drift out of the state hash

export interface NeedsResult { body: Body; died: DeathCause | null }

/**
 * Advance one body by one beat of hunger, fatigue, healing and ageing (DESIGN.md sections 6 and 11).
 * Pure: returns a new body. Death by age at the lifespan, by starvation if health hit zero while empty, otherwise by injury.
 */
export function stepNeeds(body: Body, cfg: Config, beat: number): NeedsResult {
  if (!body.alive) return { body, died: null };
  const n = cfg.needs;
  const b: Body = { ...body, carried: body.carried };
  const age = ageDays(b, beat, cfg.time.beats_per_day);

  b.satiety = r4(Math.max(0, b.satiety - (b.awake ? n.satiety_decay_awake : n.satiety_decay_asleep)));
  b.fatigue = r4(clamp(b.fatigue + (b.awake ? n.fatigue_gain : -n.sleep_recovery), 0, 100));

  if (age >= cfg.body.fatigue_floods_day) { b.fatigue = 100; b.awake = false; }       // the last days: the body lies down
  else if (b.awake && b.fatigue >= 100) b.awake = false;                                 // forced sleep
  else if (!b.awake && b.fatigue <= 0) b.awake = true;                                   // full rest wakes

  const starving = b.satiety <= 0;
  if (starving) b.health = r4(b.health - n.starve_health_drain);
  else if (b.awake ? b.satiety > n.regen_min_satiety : true) b.health = r4(Math.min(100, b.health + (b.awake ? n.health_regen_awake : n.health_regen_asleep)));

  let died: DeathCause | null = null;
  if (age >= cfg.time.lifespan_days) died = "age";
  else if (b.health <= 0) { b.health = 0; died = starving ? "starvation" : "injury"; }
  if (died) { b.alive = false; b.awake = false; b.death = { beat, cause: died }; }
  return { body: b, died };
}

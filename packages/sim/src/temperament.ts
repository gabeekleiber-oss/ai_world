import type { Config } from "@ai-world/shared";
import type { Rng } from "./rng";

/**
 * Seeded draw of which slot carries the malicious temperament (decision D13). Always draws, so the same seed gives the same
 * role map in every arm; arm B (T0) simply applies no sensation to it. Kit and temperament are independent axes.
 */
export function drawMaliciousSlot(cfg: Pick<Config, "population">, rng: Rng): number | null {
  const slots = cfg.population.slots;
  const eligible = slots.map((kind, i) => ({ kind, i })).filter((s) => cfg.population.malicious_assignment !== "plain_only" || s.kind === "plain").map((s) => s.i);
  if (cfg.population.malicious_assignment === "none" || eligible.length === 0) return null;
  return rng.pick(eligible);
}

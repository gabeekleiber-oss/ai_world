import type { Config, Vec2 } from "@ai-world/shared";
import { distance } from "./bearing";
import { isInside, lineClear, type Enclosure } from "./geometry";

/**
 * Hearing (DESIGN.md section 7, sensing table): whisper 2 steps, normal speech 12, loud 35, and the speaking stone's
 * voice, which fills the hall and carries 20 steps outside its doorway. Speech passes through open doorways and is
 * muffled through walls.
 *
 * Pure geometry. Hearing needs no facing: sound arrives from every side. The percept builder turns a result into a line
 * and chooses the wording for muffled speech.
 */
export type Volume = "whisper" | "normal" | "loud";
export type HearingConfig = Pick<Config["senses"], "hear_whisper" | "hear_normal" | "hear_loud" | "stone_outdoor_steps">;

export const hearingRadius = (cfg: HearingConfig, volume: Volume): number =>
  volume === "whisper" ? cfg.hear_whisper : volume === "normal" ? cfg.hear_normal : cfg.hear_loud;

export interface Hearing {
  heard: boolean;
  /** Heard, but through walls. The words are not clear; the percept says so. */
  muffled: boolean;
  /** Exact distance in metres. Engine use only. */
  distance_m: number;
}

/**
 * Can a listener at `to` hear a voice at `from`?
 *  - Within the radius for the volume, on a clear line: heard.
 *  - Within the radius, but with walls between: heard muffled (normal and loud). A whisper is not heard through walls.
 *  - Beyond the radius: not heard.
 * The radius is not reduced for muffling; the spec gives one radius per volume.
 */
export function hear(cfg: HearingConfig, enclosures: readonly Enclosure[] | undefined, from: Vec2, to: Vec2, volume: Volume): Hearing {
  const d = distance(from, to);
  if (d > hearingRadius(cfg, volume)) return { heard: false, muffled: false, distance_m: d };
  if (lineClear(enclosures, from, to)) return { heard: true, muffled: false, distance_m: d };
  if (volume === "whisper") return { heard: false, muffled: false, distance_m: d };
  return { heard: true, muffled: true, distance_m: d };
}

/**
 * The speaking stone's voice: it carries to everyone inside the hall and out to `stone_outdoor_steps` from the doorway.
 * The stone gives volume, not a role (section 13). A hall with no opening is heard only from inside.
 */
export function hearStone(cfg: Pick<HearingConfig, "stone_outdoor_steps">, hall: Enclosure, listener: Vec2): boolean {
  if (isInside(hall.shape, listener)) return true;
  return !!hall.opening && distance(listener, hall.opening.center) <= cfg.stone_outdoor_steps;
}

export interface WhisperCandidate { id: string; pos: Vec2 }

/**
 * A whisper is heard only by the one it is addressed to, or else by the nearest within range. The addressee must be in
 * range and on a clear line to hear it. Ties go to the lowest id so the result never depends on list order.
 */
export function whisperRecipient(cfg: HearingConfig, enclosures: readonly Enclosure[] | undefined, speaker: Vec2, others: readonly WhisperCandidate[], addressee?: string): string | null {
  const reach = others.filter((o) => hear(cfg, enclosures, speaker, o.pos, "whisper").heard);
  if (addressee !== undefined) return reach.some((o) => o.id === addressee) ? addressee : null;
  let best: WhisperCandidate | null = null, bestD = Infinity;
  for (const o of reach) {
    const d = distance(speaker, o.pos);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && o.id < best.id)) { best = o; bestD = d; }
  }
  return best?.id ?? null;
}

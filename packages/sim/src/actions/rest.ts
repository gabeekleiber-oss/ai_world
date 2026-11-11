import type { Config } from "@ai-world/shared";
import { ageDays, type Body } from "../bodies";

/**
 * Rest and sleep (DESIGN.md section 6 lifecycle, section 8 `rest`, section 11 sleep).
 * Pure functions returning new bodies. Recovery itself (fatigue falling 8 per beat, waking at 0, forced sleep at 100, the
 * body lying down at day 98) is `stepNeeds` in needs.ts, run at the start of every beat; this module only starts a rest
 * and decides which disturbances wake a sleeper.
 */
export type RestCode = "resting" | "cannot_act";

/** `rest`: lie down and sleep. Fatigue recovers beat by beat; the body wakes at full rest or when disturbed. */
export function startRest(body: Body): { body: Body; code: RestCode } {
  if (!body.alive) return { body, code: "cannot_act" };
  return { body: body.awake ? { ...body, awake: false } : body, code: "resting" };
}

export type Volume = "whisper" | "normal" | "loud";

/** Things that can wake a sleeper (section 11 wake triggers). Sounds carry the distance from the sleeper in steps. */
export type Disturbance =
  | { kind: "sound"; volume: Volume; distance: number }
  | { kind: "touched" }
  | { kind: "struck" };

/** A loud sound within `wake_loud_steps`, being touched, or being struck wakes a sleeper. Speech at normal volume or below does not. */
export function wakesSleeper(d: Disturbance, cfg: Pick<Config, "senses">): boolean {
  if (d.kind === "sound") return d.volume === "loud" && d.distance <= cfg.senses.wake_loud_steps;
  return true;
}

/**
 * Wake a sleeping body if any disturbance qualifies. In the last days of life (from `fatigue_floods_day`) the body cannot
 * be woken: it lies down and stays down until it dies (section 6), so a disturbance changes nothing.
 */
export function wakeIfDisturbed(body: Body, cfg: Config, beat: number, disturbances: readonly Disturbance[]): { body: Body; woke: boolean } {
  if (!body.alive || body.awake) return { body, woke: false };
  if (ageDays(body, beat, cfg.time.beats_per_day) >= cfg.body.fatigue_floods_day) return { body, woke: false };
  if (!disturbances.some((d) => wakesSleeper(d, cfg))) return { body, woke: false };
  return { body: { ...body, awake: true }, woke: true };
}

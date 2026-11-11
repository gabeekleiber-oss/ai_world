import type { Config } from "@ai-world/shared";
import type { Body } from "../bodies";

/** `wait` and `rest` (DESIGN.md sections 8 and 11). Pure helpers; the beat loop applies them. */

/** Clamp a requested wait to 1..wait_max_beats. */
export function clampWait(beats: number | undefined, cfg: Config): number {
  const n = Math.floor(beats ?? 1);
  return Math.min(cfg.actions.wait_max_beats, Math.max(1, Number.isFinite(n) ? n : 1));
}

/** Lie down. A body that is not awake or not alive cannot start resting. */
export function startRest(body: Body): { body: Body; ok: boolean } {
  if (!body.alive || !body.awake) return { body, ok: false };
  return { body: { ...body, awake: false }, ok: true };
}

export type WakeReason = "loud_sound" | "touched" | "struck" | "rested";

export interface WakeSignals {
  /** Distance in steps to the nearest loud sound this beat, if any. */
  loud_sound_steps?: number | null;
  touched?: boolean;
  struck?: boolean;
}

/** Wake triggers (section 11): a loud sound within wake_loud_steps, being touched, being struck, or full recovery. */
export function wakeReason(body: Body, s: WakeSignals, cfg: Config): WakeReason | null {
  if (!body.alive || body.awake) return null;
  if (s.struck) return "struck";
  if (s.touched) return "touched";
  if (s.loud_sound_steps != null && s.loud_sound_steps <= cfg.senses.wake_loud_steps) return "loud_sound";
  if (body.fatigue <= 0) return "rested";
  return null;
}

export function wake(body: Body): Body {
  return body.alive ? { ...body, awake: true } : body;
}

/** Apply wake triggers to a sleeping body. */
export function applyWake(body: Body, s: WakeSignals, cfg: Config): { body: Body; reason: WakeReason | null } {
  const reason = wakeReason(body, s, cfg);
  return { body: reason ? wake(body) : body, reason };
}

import type { Config } from "@ai-world/shared";
import type { MoveOrder } from "./actions/move";

/**
 * Multi-beat continuation (DESIGN.md section 8). `move` with a target, `drag`, `rest` and `wait` carry on across beats without
 * asking the mind again. This is purely an economy of calls; it never changes what an agent can do.
 * The mind is asked again when something new comes into sight, a sound at normal volume or above, hurt, arrival at the target,
 * a held item changes, or after `continuation_max_beats` beats.
 * Two readings of the spec, stated so they can be changed in one place:
 *  - `wait` runs for the number of beats the mind chose (up to wait_max_beats), not capped at 3, because the mind chose it.
 *  - `rest` is not capped either; it ends when the body wakes (section 11), which keeps sleeping bodies out of the call budget.
 */
export type ContinuingAct = "move" | "drag" | "rest" | "wait";
export type Volume = "whisper" | "normal" | "loud";

export interface Continuation {
  act: ContinuingAct;
  started_beat: number;
  /** Beats already carried out under this order, not counting the one the mind decided. */
  beats_run: number;
  /** For wait: the beats the mind asked for. */
  wait_beats?: number;
  order?: MoveOrder;
}

export interface InterruptSignals {
  new_in_sight?: boolean;
  sound?: Volume | null;
  hurt?: boolean;
  arrived?: boolean;
  held_changed?: boolean;
  /** For rest: the body is awake again. */
  woke?: boolean;
}

export type InterruptReason = "new_in_sight" | "sound" | "hurt" | "arrived" | "held_changed" | "max_beats" | "woke" | "wait_done";

const LOUD_ENOUGH: Record<Volume, boolean> = { whisper: false, normal: true, loud: true };

export function startContinuation(act: ContinuingAct, beat: number, extra: { wait_beats?: number; order?: MoveOrder } = {}): Continuation {
  return { act, started_beat: beat, beats_run: 0, ...extra };
}

/** Why the mind must be asked again, or null to carry on. Checked in a fixed order so the reason logged is stable. */
export function interruptReason(c: Continuation, s: InterruptSignals, cfg: Config): InterruptReason | null {
  if (s.hurt) return "hurt";
  if (c.act === "rest") return s.woke ? "woke" : null; // only waking ends a sleep
  if (s.arrived) return "arrived";
  if (s.new_in_sight) return "new_in_sight";
  if (s.sound && LOUD_ENOUGH[s.sound]) return "sound";
  if (s.held_changed) return "held_changed";
  if (c.act === "wait") return c.beats_run >= (c.wait_beats ?? 1) ? "wait_done" : null;
  if (c.beats_run >= cfg.actions.continuation_max_beats) return "max_beats";
  return null;
}

export interface ContinuationStep { continue: boolean; reason: InterruptReason | null; next: Continuation | null }

/**
 * Called once per beat for a body under a continuing order, after the beat's signals are known.
 * Counts the beat that just ran, then decides whether to carry on.
 */
export function tickContinuation(c: Continuation, s: InterruptSignals, cfg: Config): ContinuationStep {
  const counted: Continuation = { ...c, beats_run: c.beats_run + 1 };
  const reason = interruptReason(counted, s, cfg);
  return reason ? { continue: false, reason, next: null } : { continue: true, reason: null, next: counted };
}

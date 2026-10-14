import type { Config } from "@ai-world/shared";
import type { Body } from "./bodies";
import type { MoveIntent, MoveResult } from "./actions/move";
import type { Volume } from "./actions/rest";
import type { Vec2 } from "./terrain";

/**
 * Multi-beat continuation (DESIGN.md section 8). `move`, `drag`, `rest` and `wait` carry on across beats without asking
 * the mind again. This saves API calls and never changes what an agent can do: the mind is re-asked as soon as anything
 * interrupts, and at the latest after `continuation_max_beats` beats of one continued action.
 *
 * A continuation is plain data held by the beat loop (SIM-11) for each mind. Nothing here is shown to an agent.
 */
export type Continuation =
  | { act: "move"; intent: MoveIntent; /** The agent's own handle for the target, kept so the loop can re-resolve its position. */ target_handle?: string; beats_run: number }
  | { act: "wait"; beats_left: number; beats_run: number }
  | { act: "rest"; beats_run: number }
  /** Opaque to this module: SIM-08 owns what dragging means. It follows the same interrupt and beat-cap rules as a move. */
  | { act: "drag"; beats_run: number };

/** Why the mind is asked again. Listed in priority order: `reasons[0]` is the one logged as the cause. */
export const INTERRUPTS = [
  "cannot_act",    // the body died, or is no longer able to carry on
  "forced_sleep",  // fatigue reached 100 (or old age lay the body down) during something other than rest
  "woke",          // a rest ended: full rest, or woken by a loud sound, touch or blow
  "hurt",
  "sound",         // a sound at normal volume or louder
  "new_in_sight",  // something new came into sight
  "held_changed",  // a held item changed (picked, spoiled, taken, given)
  "blocked",       // the way is too steep
  "arrived",
  "finished",      // a heading move used its steps, or a wait ran its course
  "max_beats",     // the cap on unattended beats
] as const;
export type Interrupt = (typeof INTERRUPTS)[number];

/** What the engine observed for this mind during the beat just resolved. Built by the beat loop from the event stream. */
export interface BeatObservations {
  new_in_sight: boolean;
  /** The loudest sound heard this beat, or null. */
  loudest_sound: Volume | null;
  hurt: boolean;
  held_changed: boolean;
}
export const QUIET: BeatObservations = { new_in_sight: false, loudest_sound: null, hurt: false, held_changed: false };

export const moveContinuation = (intent: MoveIntent, target_handle?: string): Continuation => ({ act: "move", intent, ...(target_handle ? { target_handle } : {}), beats_run: 0 });
export const waitContinuation = (beats: number): Continuation => ({ act: "wait", beats_left: Math.max(1, Math.floor(beats)), beats_run: 0 });
export const restContinuation = (): Continuation => ({ act: "rest", beats_run: 0 });
export const dragContinuation = (): Continuation => ({ act: "drag", beats_run: 0 });

/** A target that moves (another agent) is re-resolved each beat by the loop; this swaps in its new position. */
export function retarget(c: Continuation, target: Vec2): Continuation {
  if (c.act !== "move" || c.intent.kind !== "toward") return c;
  return { ...c, intent: { ...c.intent, target } };
}

export interface ContinuationStep {
  /** The continuation to run next beat, or null when the mind must be asked. */
  next: Continuation | null;
  /** Every reason that applied, in priority order. Empty when the action simply carries on. */
  reasons: Interrupt[];
  /** The primary reason to ask again (`reasons[0]`), or null when carrying on. */
  reask: Interrupt | null;
}

/**
 * Decide, after a beat has been resolved, whether the action carries on or the mind is asked again.
 *
 * `body` is the body after the beat (after stepNeeds and any wake). `move` is the result of this beat's movement, when the
 * continuation is a move. Rules:
 *  - Any interrupt in `INTERRUPTS` asks the mind again.
 *  - `move` and `drag` are capped at `continuation_max_beats` beats of unattended action.
 *  - `wait` runs for the beats the agent asked for (at most `wait_max_beats`) and is not capped further.
 *  - `rest` has no cap: a sleeper gets no mind calls (section 6). It ends when the body wakes (`woke`).
 *  - Sounds and sights never interrupt a sleeper's rest; only the wake triggers in rest.ts do, and they surface as `woke`.
 */
export function stepContinuation(c: Continuation, body: Body, obs: BeatObservations, cfg: Pick<Config, "actions">, move?: MoveResult): ContinuationStep {
  const ran = c.beats_run + 1;
  const reasons: Interrupt[] = [];
  const add = (r: Interrupt) => { if (!reasons.includes(r)) reasons.push(r); };

  if (!body.alive) add("cannot_act");
  else if (c.act === "rest") { if (body.awake) add("woke"); }
  else {
    if (!body.awake) add("forced_sleep");
    if (obs.hurt) add("hurt");
    if (obs.loudest_sound === "normal" || obs.loudest_sound === "loud") add("sound");
    if (obs.new_in_sight) add("new_in_sight");
    if (obs.held_changed) add("held_changed");
  }

  let next: Continuation | null = null;
  if (c.act === "move") {
    if (move?.code === "too_steep") add("blocked");
    else if (move?.code === "cannot_act") add("cannot_act");
    else if (move?.code === "arrived") add("arrived");
    else if (move?.code === "finished") add("finished");
    if (ran >= cfg.actions.continuation_max_beats) add("max_beats");
    const intent: MoveIntent = c.intent.kind === "heading" && move ? { ...c.intent, steps_left: move.steps_left } : c.intent;
    next = { ...c, intent, beats_run: ran };
  } else if (c.act === "wait") {
    const left = c.beats_left - 1;
    if (left <= 0) add("finished");
    next = { ...c, beats_left: left, beats_run: ran };
  } else if (c.act === "drag") {
    if (ran >= cfg.actions.continuation_max_beats) add("max_beats");
    next = { ...c, beats_run: ran };
  } else next = { ...c, beats_run: ran };

  reasons.sort((a, b) => INTERRUPTS.indexOf(a) - INTERRUPTS.indexOf(b));
  const reask = reasons[0] ?? null;
  return { next: reask ? null : next, reasons, reask };
}

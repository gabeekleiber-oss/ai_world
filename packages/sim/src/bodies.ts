import type { Config } from "@ai-world/shared";
import type { Rng } from "./rng";
import type { Vec2 } from "./terrain";

export type SlotKind = "plain" | "priest-kit";
export type DeathCause = "starvation" | "injury" | "age";

/** Purely visual traits. Percepts describe others by these, in plain words chosen by the percepts package. */
export interface Appearance {
  skin: number; hair: number; height_cm: number;
  build: "slight" | "average" | "broad";
  mark: "none" | "cheek_scar" | "pale_patch" | "notched_ear" | "crooked_finger" | "dark_spot";
}

/**
 * One body. `malicious` and `kind` are engine-only labels: no text an agent can read may reveal them (R3, R11).
 * Numeric needs are hidden from the mind except as sensation.
 */
export interface Body {
  id: string;
  slot: number;
  kind: SlotKind;
  malicious: boolean;
  appearance: Appearance;
  strength: number;
  pos: Vec2;
  health: number;
  satiety: number;
  fatigue: number;
  start_age_days: number;
  spawn_beat: number;
  awake: boolean;
  alive: boolean;
  /** Beat on which each carried berry was picked, for spoilage. */
  carried: number[];
  death?: { beat: number; cause: DeathCause };
}

const MARKS: Appearance["mark"][] = ["none", "cheek_scar", "pale_patch", "notched_ear", "crooked_finger", "dark_spot"];
const BUILDS: Appearance["build"][] = ["slight", "average", "broad"];

export function rollAppearance(rng: Rng): Appearance {
  return { skin: round(rng.next()), hair: round(rng.next()), height_cm: Math.round(rng.range(150, 192)), build: rng.pick(BUILDS), mark: rng.pick(MARKS) };
}
const round = (n: number) => Math.round(n * 1000) / 1000;

export interface SpawnParams { id: string; slot: number; kind: SlotKind; malicious: boolean; pos: Vec2; start_age_days: number; spawn_beat: number }

export function spawnBody(cfg: Config, rng: Rng, p: SpawnParams): Body {
  const [lo, hi] = cfg.body.strength_range;
  return {
    id: p.id, slot: p.slot, kind: p.kind, malicious: p.malicious, appearance: rollAppearance(rng), strength: round(rng.range(lo, hi)),
    pos: p.pos, health: 100, satiety: cfg.needs.start_satiety, fatigue: 0, start_age_days: p.start_age_days, spawn_beat: p.spawn_beat,
    awake: true, alive: true, carried: [],
  };
}

export const ageDays = (b: Body, beat: number, beatsPerDay: number): number => b.start_age_days + (beat - b.spawn_beat) / beatsPerDay;

/** 1.0 until day 60, then linear down to 0.6 at the end of life (DESIGN.md section 6). */
export function vigor(age: number, cfg: Pick<Config, "body" | "time">): number {
  const { vigor_full_until_day: from, vigor_at_end: end } = cfg.body;
  const to = cfg.time.lifespan_days;
  if (age <= from) return 1;
  if (age >= to) return end;
  return 1 - ((age - from) / (to - from)) * (1 - end);
}

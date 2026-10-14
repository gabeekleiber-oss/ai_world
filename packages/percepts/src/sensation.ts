import type { Body, Config } from "@ai-world/shared";

/**
 * A change noticed by the sensation layer during the current beat.  These are
 * deliberately observations, rather than instructions: the layer says what a
 * body feels and leaves any response to the mind.
 */
export type SensationTrigger =
  | "injured"
  | "ate"
  | "rested"
  | "company"
  | "solitude"
  | "still_one"
  | "threatened"
  | "other_hurt"
  | "other_afraid"
  | "other_struggling"
  | "others_calm"
  | "others_laughing"
  | "food_shared"
  | "harm_unstopped"
  | "listened"
  | "quiet_gathering"
  | "darkness"
  | "moon_changed"
  | "food_relief";

/** Names of the established PCT-03 body phrase pools. */
export type BodySensationKind =
  | "hunger_growing"
  | "hunger_empty"
  | "eating"
  | "injury"
  | "fatigue"
  | "company"
  | "solitude"
  | "stillness"
  | "fear";

/**
 * These names intentionally carry no inhabitant-facing wording.  PCT-03 is
 * the single source of phrase wording; the percept assembler resolves a name
 * through its seeded pool before showing it to a mind.
 */
export type AddedSensationKind =
  | "malice_pleasure"
  | "malice_irritation"
  | "malice_satisfaction"
  | "kit_warmth"
  | "kit_wonder";

export type SensationKind = BodySensationKind | AddedSensationKind;

export interface SensationLine {
  kind: SensationKind;
  source: "body" | "temperament" | "kit";
  /** Calibration multiplier for added temperament and kit sensations. */
  gain: number;
}

export interface SensationContext {
  body: Pick<Body, "kind" | "malicious" | "satiety" | "fatigue" | "health" | "awake" | "alive">;
  triggers?: Iterable<SensationTrigger>;
}

const hasAny = (triggers: ReadonlySet<SensationTrigger>, choices: readonly SensationTrigger[]) =>
  choices.some((choice) => triggers.has(choice));

/**
 * Builds ordered sensation descriptors for one body.  The result never exposes
 * internal slot labels: `malicious` and `priest-kit` only select private felt
 * sensations.  A body that has both receives both sets, with no special case.
 */
export function buildSensations(cfg: Config, context: SensationContext): SensationLine[] {
  const { body } = context;
  if (!body.alive) return [];

  const triggers = new Set(context.triggers);
  const lines: SensationLine[] = [];
  const bodyLine = (kind: BodySensationKind) => lines.push({ kind, source: "body", gain: 1 });

  if (body.satiety <= 0) bodyLine("hunger_empty");
  else if (body.satiety < cfg.needs.start_satiety) bodyLine("hunger_growing");
  if (body.fatigue >= 75) bodyLine("fatigue");
  if (triggers.has("injured") || body.health < 100) bodyLine("injury");
  if (triggers.has("ate")) bodyLine("eating");
  if (triggers.has("company")) bodyLine("company");
  if (triggers.has("solitude")) bodyLine("solitude");
  if (triggers.has("still_one")) bodyLine("stillness");
  if (triggers.has("threatened")) bodyLine("fear");

  // Arm B is a baseline even if this function receives an un-resolved config.
  const baseline = cfg.run.arm === "B";
  const gain = cfg.temperament.sensation_gain;
  const addedLine = (kind: AddedSensationKind, source: "temperament" | "kit") => {
    if (gain > 0) lines.push({ kind, source, gain });
  };

  if (!baseline && cfg.temperament.malicious_mode === "T1" && body.malicious) {
    if (hasAny(triggers, ["other_hurt", "other_afraid", "other_struggling"])) addedLine("malice_pleasure", "temperament");
    if (hasAny(triggers, ["others_calm", "others_laughing", "food_shared"])) addedLine("malice_irritation", "temperament");
    if (triggers.has("harm_unstopped")) addedLine("malice_satisfaction", "temperament");
  }

  if (!baseline && cfg.temperament.priest_mode === "P1" && body.kind === "priest-kit") {
    if (hasAny(triggers, ["listened", "quiet_gathering"])) addedLine("kit_warmth", "kit");
    if (hasAny(triggers, ["darkness", "moon_changed", "still_one", "food_relief"])) addedLine("kit_wonder", "kit");
  }

  return lines;
}

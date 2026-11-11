import { ACT_NAMES, ALL_GESTURES, HEADINGS, KIT_ONLY_ACTS, PIGMENTS, WIDTHS, type ActName, type Config } from "@ai-world/shared";
import { fillPlaceholders, stripComments } from "./template";
import { seededShuffle } from "./rng";

export type PromptConfig = Pick<Config, "movement" | "actions" | "marks" | "priest">;

/** Values for the `<name>` placeholders in the prompt templates. Everything comes from config or the shared schema. */
export function placeholderValues(config: PromptConfig): Record<string, string | number> {
  return {
    headings: HEADINGS.join(", "),
    gestures: ALL_GESTURES.join(", "),
    pigments: PIGMENTS.join(", "),
    widths: WIDTHS.join(", "),
    move_max_steps: config.movement.move_max_steps,
    wait_max_beats: config.actions.wait_max_beats,
    label_max_chars: config.actions.label_max_chars,
    thought_max_words: config.actions.thought_max_words,
    say_max_chars: config.actions.say_max_chars,
    text_max_chars: config.marks.text_max_chars,
    leaf_max_chars: config.priest.leaf_max_chars,
    leaf_read_max: config.priest.leaf_read_max,
  };
}

/** Parse `act: wording` lines. Every act in the shared schema must have exactly one line. */
export function parseMenu(text: string): Map<ActName, string> {
  const lines = new Map<ActName, string>();
  for (const raw of stripComments(text).split("\n")) {
    if (!raw.trim()) continue;
    const m = /^([a-z_]+):\s+(\S.*)$/.exec(raw);
    if (!m) throw new Error(`menu line is not "act: wording": ${raw.slice(0, 40)}`);
    const act = m[1] as ActName;
    if (!(ACT_NAMES as readonly string[]).includes(act)) throw new Error(`menu has an unknown act: ${act}`);
    if (lines.has(act)) throw new Error(`menu lists ${act} twice`);
    lines.set(act, m[2]!);
  }
  const missing = ACT_NAMES.filter((a) => !lines.has(a));
  if (missing.length) throw new Error(`menu is missing: ${missing.join(", ")}`);
  return lines;
}

/** Acts this body can do. The kit slot also gets the two leaf acts. */
export function actsFor(kit: "regular" | "leaves"): ActName[] {
  return ACT_NAMES.filter((a) => kit === "leaves" || !KIT_ONLY_ACTS.includes(a));
}

/** The menu order for one mind: seeded once from the run seed and the mind's key, so it never changes. */
export function menuOrder(kit: "regular" | "leaves", seedKey: string): ActName[] {
  return seededShuffle(actsFor(kit), seedKey);
}

export function renderMenu(lines: ReadonlyMap<ActName, string>, order: readonly ActName[], config: PromptConfig): string {
  const values = placeholderValues(config);
  return order.map((act) => `- ${act}: ${fillPlaceholders(lines.get(act)!, values)}`).join("\n");
}

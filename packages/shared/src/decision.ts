import { z } from "zod";
import type { Config } from "./config";
import { HandleSchema, HeadingSchema } from "./handles";
import { DrawingSchema } from "./marks";

export const GESTURES_DEFAULT = ["point", "wave", "beckon", "holdout-hand", "raise-arms", "kneel", "bow-head", "nod", "shake-head", "embrace"] as const;
export const GESTURES_NEUTRAL = ["point", "beckon", "holdout-hand", "raise-arms", "step-back", "turn-away"] as const;
export const ALL_GESTURES = [...new Set([...GESTURES_DEFAULT, ...GESTURES_NEUTRAL])] as [string, ...string[]];

/** Internal act names (DESIGN.md section 8). The menu shown to agents uses plain verbs; the prompt builder maps them. */
export const ACT_NAMES = ["move", "turn", "wait", "rest", "pick", "eat", "drop", "give", "take", "hit", "push", "drag", "gesture", "look", "label", "study_mark", "mark_prepare", "mark_commit", "mark_abandon", "leaf_write", "leaf_read"] as const;
export type ActName = (typeof ACT_NAMES)[number];
export const KIT_ONLY_ACTS: readonly ActName[] = ["leaf_write", "leaf_read"];
/** Acts that continue across beats without asking the mind again (multi-beat continuation). */
export const CONTINUING_ACTS: readonly ActName[] = ["move", "drag", "rest", "wait"];

export function buildActionSchema(cfg: Pick<Config, "movement" | "actions" | "priest">) {
  const { move_max_steps } = cfg.movement;
  const options = [
    z.object({ act: z.literal("move"), to: HandleSchema.optional(), heading: HeadingSchema.optional(), steps: z.number().int().min(1).max(move_max_steps).optional(), gait: z.enum(["walk", "run"]).default("walk") }),
    z.object({ act: z.literal("turn"), to: HandleSchema.optional(), heading: HeadingSchema.optional() }),
    z.object({ act: z.literal("wait"), beats: z.number().int().min(1).max(cfg.actions.wait_max_beats).default(1) }),
    z.object({ act: z.literal("rest") }),
    z.object({ act: z.literal("pick"), from: HandleSchema }),
    z.object({ act: z.literal("eat"), from: HandleSchema.optional() }),
    z.object({ act: z.literal("drop"), item: z.string().min(1), count: z.number().int().min(1).default(1) }),
    z.object({ act: z.literal("give"), to: HandleSchema, count: z.number().int().min(1).default(1) }),
    z.object({ act: z.literal("take"), from: HandleSchema }),
    z.object({ act: z.literal("hit"), target: HandleSchema, force: z.enum(["light", "hard"]) }),
    z.object({ act: z.literal("push"), target: HandleSchema }),
    z.object({ act: z.literal("drag"), target: HandleSchema.optional(), release: z.boolean().optional() }),
    z.object({ act: z.literal("gesture"), kind: z.enum(ALL_GESTURES), target: HandleSchema.optional() }),
    z.object({ act: z.literal("look"), at: HandleSchema }),
    z.object({ act: z.literal("label"), handle: HandleSchema, text: z.string().min(1) }),
    z.object({ act: z.literal("study_mark"), handle: HandleSchema }),
    z.object({ act: z.literal("mark_prepare"), mode: z.enum(["text", "drawing"]), content: z.union([z.string(), DrawingSchema]) }),
    z.object({ act: z.literal("mark_commit") }),
    z.object({ act: z.literal("mark_abandon") }),
    z.object({ act: z.literal("leaf_write"), text: z.string().min(1) }),
    z.object({ act: z.literal("leaf_read"), last_n: z.number().int().min(1).max(cfg.priest.leaf_read_max).optional(), search: z.string().min(1).optional() }),
  ] as const;
  return z.discriminatedUnion("act", options).superRefine((a, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (a.act === "move" && !a.to && !(a.heading && a.steps)) issue("move needs a handle, or a heading and steps");
    if (a.act === "turn" && !a.to && !a.heading) issue("turn needs a handle or a heading");
    if (a.act === "drag" && !a.target && !a.release) issue("drag needs a target, or release");
    if (a.act === "leaf_read" && a.last_n === undefined && a.search === undefined) issue("leaf_read needs last_n or search");
    if (a.act === "mark_prepare") {
      if (a.mode === "text" && typeof a.content !== "string") issue("a text mark needs a string");
      if (a.mode === "drawing" && typeof a.content === "string") issue("a drawing mark needs strokes");
    }
  });
}
export type Action = z.infer<ReturnType<typeof buildActionSchema>>;

export const VOLUMES = ["whisper", "normal", "loud"] as const;

export function buildDecisionSchema(cfg: Pick<Config, "movement" | "actions" | "priest">) {
  return z.object({
    thought: z.string().default(""),
    say: z.object({ text: z.string(), volume: z.enum(VOLUMES).default("normal"), to: HandleSchema.nullable().default(null) }).nullable().optional(),
    do: buildActionSchema(cfg),
  });
}
export type Decision = z.infer<ReturnType<typeof buildDecisionSchema>>;

export interface Truncation { field: string; from: number; to: number }

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function stripControl(s: string): string { return s.replace(CONTROL, ""); }

/**
 * Apply the hard caps from DESIGN.md section 8 step 7: strip control characters and truncate over-long text.
 * Nothing else about what an agent said is changed (R9). Every truncation is returned so it can be logged.
 */
export function capDecision(d: Decision, cfg: Pick<Config, "actions" | "marks" | "priest">): { decision: Decision; truncations: Truncation[] } {
  const truncations: Truncation[] = [];
  const cut = (field: string, s: string, max: number): string => {
    const clean = stripControl(s);
    if (clean.length <= max) return clean;
    truncations.push({ field, from: clean.length, to: max });
    return clean.slice(0, max);
  };
  const out: Decision = structuredClone(d);
  const words = out.thought.trim().split(/\s+/).filter(Boolean);
  if (words.length > cfg.actions.thought_max_words) {
    truncations.push({ field: "thought", from: words.length, to: cfg.actions.thought_max_words });
    out.thought = words.slice(0, cfg.actions.thought_max_words).join(" ");
  } else out.thought = stripControl(out.thought);
  if (out.say) out.say.text = cut("say.text", out.say.text, cfg.actions.say_max_chars);
  const a = out.do;
  if (a.act === "label") a.text = cut("do.text", a.text, cfg.actions.label_max_chars);
  if (a.act === "leaf_write") a.text = cut("do.text", a.text, cfg.priest.leaf_max_chars);
  if (a.act === "mark_prepare" && typeof a.content === "string") a.content = cut("do.content", a.content, cfg.marks.text_max_chars);
  return { decision: out, truncations };
}

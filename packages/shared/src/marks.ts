import { z } from "zod";

export const PIGMENTS = ["brown-yellow", "dark", "red", "pale"] as const;
export const WIDTHS = ["thin", "medium", "thick"] as const;

const Point = z.tuple([z.number(), z.number()]);

export const StrokeSchema = z.object({
  pigment: z.enum(PIGMENTS),
  width: z.enum(WIDTHS),
  points: z.array(Point).min(1).max(40),
});
export const DrawingSchema = z.object({ strokes: z.array(StrokeSchema).min(1) });
export type Drawing = z.infer<typeof DrawingSchema>;

export interface DrawingLimits { maxStrokes: number; maxPoints: number; canvas: [number, number] }

/** Values are clamped, not rejected (section 12). Excess strokes and points are dropped; returns what was cut. */
export function normalizeDrawing(d: Drawing, lim: DrawingLimits): { drawing: Drawing; truncated: boolean } {
  let truncated = false;
  let budget = lim.maxPoints;
  const strokes: Drawing["strokes"] = [];
  for (const s of d.strokes) {
    if (strokes.length >= lim.maxStrokes || budget <= 0) { truncated = true; break; }
    let pts = s.points;
    if (pts.length > budget) { pts = pts.slice(0, budget); truncated = true; }
    budget -= pts.length;
    const clamped = pts.map(([x, y]) => [clamp(x, 0, lim.canvas[0]), clamp(y, 0, lim.canvas[1])] as [number, number]);
    strokes.push({ ...s, points: clamped });
  }
  if (d.strokes.length > strokes.length) truncated = true;
  return { drawing: { strokes }, truncated };
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

/** Full mark record (section 12). author_* fields are internal and never shown to agents. */
export const MarkRecordSchema = z.object({
  schema_version: z.literal(1),
  mark_id: z.number().int().nonnegative(),
  author_mind_id: z.string(),
  author_slot: z.string(),
  game_day: z.number(),
  beat: z.number().int(),
  real_time: z.string(),
  kind: z.enum(["text", "drawing"]),
  content: z.union([z.string(), DrawingSchema]),
  pigment: z.enum(PIGMENTS).optional(),
  wall_slot: z.number().int().nonnegative(),
  position_3d: z.tuple([z.number(), z.number(), z.number()]),
  witnesses: z.array(z.string()),
  context: z.object({ thought: z.string(), last_events: z.array(z.unknown()).max(10), body_state: z.record(z.unknown()) }),
});
export type MarkRecord = z.infer<typeof MarkRecordSchema>;

/** One entry in the priest's leaf stack (section 13). */
export const LeafEntrySchema = z.object({
  schema_version: z.literal(1),
  entry_id: z.number().int().nonnegative(),
  priest_number: z.number().int().positive(),
  game_day: z.number(),
  beat: z.number().int(),
  text: z.string(),
});
export type LeafEntry = z.infer<typeof LeafEntrySchema>;

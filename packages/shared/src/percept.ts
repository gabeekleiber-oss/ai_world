import { z } from "zod";

/**
 * Percept sections in truncation priority order: the last entry is cut first when the token budget is
 * exceeded (DESIGN.md section 7). Rendering to text is done by the percepts package (WP2), under the word lint.
 */
export const PERCEPT_SECTIONS = ["last_result", "body", "heard", "in_sight", "known_places", "light_weather", "holdings_marks", "memory"] as const;
export type PerceptSection = (typeof PERCEPT_SECTIONS)[number];

export const PerceptSchema = z.object({
  last_result: z.array(z.string()),
  body: z.array(z.string()),
  heard: z.array(z.string()),
  in_sight: z.array(z.object({ handle: z.string(), description: z.string(), bearing: z.string(), steps: z.number().nonnegative() })),
  known_places: z.array(z.object({ handle: z.string(), label: z.string().nullable(), description: z.string(), bearing: z.string(), steps: z.number().nonnegative(), seen: z.string() })),
  light_weather: z.string(),
  holdings_marks: z.object({ holding: z.string(), marks_left: z.number().int().nonnegative().nullable() }),
  memory: z.string(),
});
export type Percept = z.infer<typeof PerceptSchema>;

/** Snapshot envelope. The world and bodies payloads are defined by the sim package (WP1). */
export const SnapshotSchema = z.object({
  schema_version: z.literal(1),
  last_seq: z.number().int().nonnegative(),
  game_day: z.number().nonnegative(),
  beat: z.number().int().nonnegative(),
  rng_state: z.array(z.number()),
  world: z.record(z.unknown()),
  bodies: z.array(z.record(z.unknown())),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

import { z } from "zod";

/**
 * World and agent state contracts (CON-01). These mirror the sim package's engine types field for field, so the viewer,
 * percepts, persistence and observatory can validate state without importing the sim. A conformance test in the sim package
 * parses a live world through these schemas and requires it to come back unchanged, so drift fails CI.
 * Engine-only labels (`kind`, `malicious`, `malicious_slot`) must never reach any text an agent can read (R3, R11).
 */
const num = z.number().finite();
const nonneg = num.nonnegative();

export const Vec2Schema = z.object({ x: num, z: num });
export type Vec2 = z.infer<typeof Vec2Schema>;

export const SlotKindSchema = z.enum(["plain", "priest-kit"]);
export type SlotKind = z.infer<typeof SlotKindSchema>;

export const TemperamentSchema = z.enum(["plain", "malicious"]);
export type Temperament = z.infer<typeof TemperamentSchema>;

export const DeathCauseSchema = z.enum(["starvation", "injury", "age"]);
export type DeathCause = z.infer<typeof DeathCauseSchema>;

export const PhaseSchema = z.enum(["dawn", "day", "dusk", "night"]);
export type Phase = z.infer<typeof PhaseSchema>;

/** Lifecycle states from DESIGN.md section 6. */
export const LifecycleSchema = z.enum(["arriving", "awake", "sleeping", "dying", "still_body", "bones"]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const MARK_KINDS = ["none", "cheek_scar", "pale_patch", "notched_ear", "crooked_finger", "dark_spot"] as const;
export const BUILDS = ["slight", "average", "broad"] as const;

/** Purely visual traits. Percepts describe others by these in plain words. */
export const AppearanceSchema = z.object({
  skin: num.min(0).max(1),
  hair: num.min(0).max(1),
  height_cm: num.positive(),
  build: z.enum(BUILDS),
  mark: z.enum(MARK_KINDS),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const BodySchema = z.object({
  id: z.string().min(1),
  slot: z.number().int().nonnegative(),
  kind: SlotKindSchema,
  malicious: z.boolean(),
  appearance: AppearanceSchema,
  strength: num.positive(),
  pos: Vec2Schema,
  health: num.min(0).max(100),
  satiety: num.min(0).max(100),
  fatigue: num.min(0).max(100),
  start_age_days: nonneg,
  spawn_beat: z.number().int().nonnegative(),
  awake: z.boolean(),
  alive: z.boolean(),
  /** Beat on which each carried berry was picked, for spoilage. Length is the carried count. */
  carried: z.array(z.number().int().nonnegative()),
  death: z.object({ beat: z.number().int().nonnegative(), cause: DeathCauseSchema }).optional(),
});
export type Body = z.infer<typeof BodySchema>;

/** A body plus the lifecycle fields the viewer and percepts need. Built by the sim from a Body and its mind. */
export const AgentStateSchema = BodySchema.extend({
  lifecycle: LifecycleSchema,
  marks_left: z.number().int().nonnegative(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

export const BushSchema = z.object({
  id: z.string().min(1),
  pos: Vec2Schema,
  berries: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  progress: nonneg,
  phase: z.enum(["normal", "dormant", "half"]),
  phase_until: z.number().int().nonnegative(),
});
export type Bush = z.infer<typeof BushSchema>;

export const ClockStateSchema = z.object({
  beat: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  beatOfDay: z.number().int().nonnegative(),
  phase: PhaseSchema,
  isNight: z.boolean(),
});
export type ClockState = z.infer<typeof ClockStateSchema>;

/** Terrain parameters only. The height field regenerates from these. Origin is the valley centre; 1 unit = 1 m. */
export const TerrainParamsSchema = z.object({
  seed: z.number().int(),
  radius_m: num.positive(),
  cliff_start_m: num.positive(),
  wall_radius_m: num.positive(),
  noise_m: nonneg,
  bowl_depth_m: nonneg,
});
export type TerrainParams = z.infer<typeof TerrainParamsSchema>;

export const LayoutSchema = z.object({
  terrain: TerrainParamsSchema,
  hall: z.object({ center: Vec2Schema, size_m: z.tuple([num.positive(), num.positive()]) }),
  cave: z.object({ mouth: Vec2Schema }),
  pond: z.object({ center: Vec2Schema, radius_m: num.positive() }),
  bushes: z.array(z.object({ id: z.string().min(1), pos: Vec2Schema })),
  starts: z.array(Vec2Schema),
  attempt: z.number().int().nonnegative(),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const RngStateSchema = z.tuple([num, num, num, num]);
export type RngState = z.infer<typeof RngStateSchema>;

export const WorldStateSchema = z.object({
  schema_version: z.literal(1),
  seed: z.number().int(),
  /** The beat the world is currently at. Beat 0 is dawn of day 0. */
  beat: z.number().int().nonnegative(),
  layout: LayoutSchema,
  bushes: z.array(BushSchema),
  bodies: z.array(BodySchema),
  next_mind_number: z.number().int().positive(),
  /** Engine-only. Which slot carries the malicious temperament. Never shown to any agent (R3). */
  malicious_slot: z.number().int().nonnegative().nullable(),
  rng: z.record(RngStateSchema),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

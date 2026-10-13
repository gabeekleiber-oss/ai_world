import { z } from "zod";

const range = z.tuple([z.number(), z.number()]);
const num = z.number();
const int = z.number().int();

export const ConfigSchema = z.object({
  schema_version: z.literal(1),
  run: z.object({ seed: int, run_id: z.string().min(1), arm: z.enum(["A", "B", "C", "D"]), max_generations: int.positive().nullable(), stop_on_extinction: z.boolean() }).strict(),
  time: z.object({ beats_per_day: int.positive(), beat_seconds: num.positive(), lifespan_days: int.positive(), night_fraction: num.min(0).max(1), dawn_beats: range, day_beats: range, dusk_beats: range, night_beats: range }).strict(),
  population: z.object({
    slots: z.array(z.enum(["plain", "priest-kit"])).min(1), malicious_assignment: z.enum(["seeded_any", "plain_only", "none"]),
    arrival_delay_days: num.nonnegative(), arrival_age: num.nonnegative(), staggered_start_ages: z.array(num.nonnegative()),
    malicious_slot_persists: z.boolean(), extinction_arrival_delay_days: num.nonnegative(),
  }).strict(),
  world: z.object({ valley_size_m: num.positive(), bush_count: int.positive(), bush_capacity: int.positive(), regrow_beats: int.positive(), spoil_beats: int.positive(), stripped_dormant_beats: int.nonnegative(), stripped_half_rate_beats: int.nonnegative(), thirst_enabled: z.boolean(), min_bush_near_start_m: num.positive(),
    hall_size_m: range, cave_dist_from_hall_m: range, bush_dist_from_hall_m: range, bush_cave_clearance_m: num.nonnegative(), bush_clusters: int.positive(),
    cluster_radius_m: num.positive(), cluster_min_sep_m: num.nonnegative(), cliff_start_fraction: num.min(0).max(1), rim_wall_fraction: num.min(0).max(1),
    pond_radius_m: num.positive(), start_sep_m: range, terrain_noise_m: num.nonnegative(), terrain_bowl_depth_m: num.nonnegative() }).strict(),
  needs: z.object({ satiety_decay_awake: num, satiety_decay_asleep: num, berry_value: num, starve_health_drain: num, fatigue_gain: num, sleep_recovery: num, health_regen_awake: num, health_regen_asleep: num, regen_min_satiety: num, start_satiety: num, carry_max: int.positive() }).strict(),
  movement: z.object({ walk_steps: num.positive(), run_steps: num.positive(), run_fatigue: num, drag_steps: num.positive(), move_max_steps: int.positive() }).strict(),
  body: z.object({ vigor_full_until_day: num, vigor_at_end: num, fatigue_floods_day: num, strength_range: range, still_body_beats: int.nonnegative() }).strict(),
  combat: z.object({ hit_light: num, hit_hard: num, hit_variance: num.min(0).max(1), reach_steps: num, give_reach_steps: num, hit_chance_standing: num.min(0).max(1), hit_chance_moving: num.min(0).max(1), hit_chance_down: num.min(0).max(1), hard_hit_attacker_fatigue: num, blood_visuals: z.boolean() }).strict(),
  senses: z.object({ vision_day_steps: num, vision_night_steps: num, vision_close_steps: num, vision_cone_degrees: num, hear_whisper: num, hear_normal: num, hear_loud: num, stone_outdoor_steps: num, wake_loud_steps: num }).strict(),
  sociability: z.object({ ease_radius_steps: num, solitude_beats: int }).strict(),
  marks: z.object({ marks_per_life: int.nonnegative(), text_max_chars: int.positive(), drawing_max_strokes: int.positive(), drawing_max_points: int.positive(), drawing_canvas: range, min_spacing_m: num, commit_beats: int.positive(), capacity_slots: int.positive(), marks_line_in_cave_only: z.boolean() }).strict(),
  priest: z.object({ leaf_max_chars: int.positive(), leaf_soft_cap: int.positive(), leaf_read_max: int.positive(), book_physical: z.boolean() }).strict(),
  temperament: z.object({ malicious_mode: z.enum(["T0", "T1", "T2"]), priest_mode: z.enum(["P0", "P1"]), sensation_gain: num.nonnegative() }).strict(),
  language: z.object({ strict_babel: z.boolean(), reask_on_meta_leak: z.boolean() }).strict(),
  actions: z.object({ thought_max_words: int.positive(), say_max_chars: int.positive(), label_max_chars: int.positive(), wait_max_beats: int.positive(), continuation_max_beats: int.positive() }).strict(),
  llm: z.object({ provider: z.string(), base_url: z.string().url(), model_id: z.string(), temperature: num, top_p: num, max_tokens: int.positive(), rpm_budget: num.positive(), timeout_s: num.positive(), compaction_every_decisions: int.positive() }).strict(),
  memory: z.object({ recent_beats: int.positive(), account_words: int.positive(), compaction_target_words: int.positive() }).strict(),
  persistence: z.object({ snapshot_every_s: num.positive(), mirror_dir: z.string().nullable(), fsync_events_every_beat: z.boolean() }).strict(),
  viewer: z.object({ quality_tier: z.enum(["low", "medium", "high", "ultra"]), zoom_min_m: num.positive(), zoom_max_m: num.positive(), thoughts_visible: z.boolean(), show_roles: z.boolean() }).strict(),
  alien: z.object({
    speech_channel: z.enum(["english", "syllabary"]), gesture_set: z.enum(["default", "neutral"]), stone_placement: z.enum(["hall_far_end", "open_ground"]),
    stage_light_shaft: z.boolean(), wonder_scope: z.enum(["kit_only", "all"]), sky_cycle: z.enum(["moon_phases", "irregular"]),
    anomalies: z.array(z.unknown()), valence_variation: num.min(0).max(1), appearance_axes: z.enum(["human", "abstract"]), models_per_mind: z.string(),
  }).strict(),
}).strict().superRefine((c, ctx) => {
  const bad = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (c.population.staggered_start_ages.length !== c.population.slots.length) bad(["population", "staggered_start_ages"], "must have one age per slot");
  for (const k of ["dawn_beats", "day_beats", "dusk_beats", "night_beats"] as const) {
    const [a, b] = c.time[k];
    if (a < 0 || b > c.time.beats_per_day || a >= b) bad(["time", k], "range must lie inside the day and be increasing");
  }
  if (c.viewer.zoom_min_m >= c.viewer.zoom_max_m) bad(["viewer", "zoom_min_m"], "must be below zoom_max_m");
  if (c.body.strength_range[0] > c.body.strength_range[1]) bad(["body", "strength_range"], "min above max");
  if (c.priest.leaf_soft_cap < 1) bad(["priest", "leaf_soft_cap"], "must be positive");
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Apply the pre-registered arm (DESIGN.md section 20). Arms fix levers before any run (R10).
 * A: defaults. B: T0 and P0 baseline. C: A plus syllabary speech. D: C plus neutral gestures, unstaged stone, irregular sky.
 */
export function applyArm(config: Config): Config {
  const c: Config = structuredClone(config);
  switch (c.run.arm) {
    case "A": break;
    case "B": c.temperament.malicious_mode = "T0"; c.temperament.priest_mode = "P0"; break;
    case "D":
      c.alien.gesture_set = "neutral"; c.alien.stone_placement = "open_ground"; c.alien.stage_light_shaft = false;
      c.alien.wonder_scope = "all"; c.alien.sky_cycle = "irregular";
      c.alien.speech_channel = "syllabary"; break;
    case "C": c.alien.speech_channel = "syllabary"; break;
  }
  return c;
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (Array.isArray(over) || typeof over !== "object" || over === null || typeof base !== "object" || base === null || Array.isArray(base)) return over as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = deepMerge((out as Record<string, unknown>)[k], v);
  return out as T;
}

/** Parse, validate and arm-adjust a raw config object. Throws a readable error on any bad key or value. */
export function resolveConfig(raw: unknown, overrides?: unknown): Config {
  const parsed = ConfigSchema.safeParse(deepMerge(raw, overrides));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid config:\n${lines.join("\n")}`);
  }
  return applyArm(parsed.data);
}

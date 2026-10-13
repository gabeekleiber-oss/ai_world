import { z } from "zod";

/** Event taxonomy (DESIGN.md section 18). Every event is stored in events.jsonl. */
export const EVENT_TYPES = [
  "beat_start", "decision", "decision_failed", "action_started", "action_result", "move", "pick", "eat", "give", "take", "hit", "push",
  "death", "arrival", "sleep_start", "sleep_end", "speech", "gathering_speech", "gesture", "label", "study", "mark_prepared",
  "mark_committed", "mark_abandoned", "leaf_written", "leaf_read", "memory_compacted", "meta_leak", "lexicon_new_token",
  "api_throttle", "api_outage", "snapshot_saved",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EventSchema = z.object({
  schema_version: z.literal(1).default(1),
  seq: z.number().int().nonnegative(),
  game_day: z.number().nonnegative(),
  beat: z.number().int().nonnegative(),
  real_time: z.string(),
  type: z.enum(EVENT_TYPES),
  /** Internal mind id of the actor, when there is one. Never shown to agents. */
  actor: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});
export type SimEvent = z.infer<typeof EventSchema>;

/** Event application must be idempotent: skip anything at or below the last applied sequence number (section 15). */
export function isNewer(e: Pick<SimEvent, "seq">, lastAppliedSeq: number): boolean { return e.seq > lastAppliedSeq; }

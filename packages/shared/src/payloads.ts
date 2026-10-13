import { z } from "zod";
import { ACT_NAMES } from "./decision";
import { EVENT_TYPES, EventSchema, type EventType, type SimEvent } from "./events";
import { DeathCauseSchema, PhaseSchema, SlotKindSchema, Vec2Schema } from "./state";

/**
 * Typed `data` payload for every event type (CON-02). The envelope in events.ts is unchanged; this adds validation of `data`.
 * Ids here are engine ids (mind-N, bush-N), never the per-agent handles an agent sees. Private thoughts never appear in an
 * event payload (R5); they go to thoughts.jsonl and the `thought` message only. Payloads are strict: a new field needs a
 * contract change, which is the point of a contract.
 */
const n = z.number().finite();
const int = z.number().int();
const count = int.nonnegative();
const id = z.string().min(1);
const Volume = z.enum(["whisper", "normal", "loud"]);
const Act = z.enum(ACT_NAMES);
const TextSource = z.enum(["say", "label", "mark", "leaf"]);

const P = {
  beat_start: z.object({ phase: PhaseSchema, awake: z.array(id), deciding: z.array(id) }),
  decision: z.object({ act: Act, params: z.record(z.unknown()), say: z.object({ text: z.string(), volume: Volume, to: id.nullable() }).nullable() }),
  decision_failed: z.object({ reason: z.enum(["timeout", "late", "unparseable", "schema", "handle", "infeasible", "meta_leak", "provider_error"]), detail: z.string().optional(), reasked: z.boolean() }),
  action_started: z.object({ act: Act, duration_beats: count, target: id.optional() }),
  action_result: z.object({ act: Act, ok: z.boolean(), code: z.string().min(1), detail: z.record(z.unknown()).optional() }),
  move: z.object({ from: Vec2Schema, to: Vec2Schema, gait: z.enum(["walk", "run"]), steps: n.nonnegative() }),
  pick: z.object({ bush: id, count, carried_after: count }),
  eat: z.object({ source: z.enum(["held", "bush"]), count, satiety_after: n }),
  give: z.object({ to: id, count }),
  take: z.object({ from: id, count, forced: z.boolean(), contest_won: z.boolean().optional() }),
  hit: z.object({ target: id, force: z.enum(["light", "hard"]), landed: z.boolean(), damage: n.nonnegative(), target_health: n, staggered: z.boolean() }),
  push: z.object({ target: id, knocked_down: z.boolean() }),
  death: z.object({ cause: DeathCauseSchema, age_days: n.nonnegative(), by: id.optional() }),
  arrival: z.object({ slot: count, kind: SlotKindSchema, age_days: n.nonnegative(), pos: Vec2Schema, priest_number: int.positive().optional() }),
  sleep_start: z.object({ forced: z.boolean() }),
  sleep_end: z.object({ reason: z.enum(["rested", "woken_sound", "woken_touch", "woken_hit"]) }),
  speech: z.object({ text: z.string(), volume: Volume, to: id.nullable(), from_stone: z.boolean(), heard_by: z.array(id) }),
  gathering_speech: z.object({ text: z.string(), listeners: z.array(id).min(1) }),
  gesture: z.object({ kind: z.string().min(1), target: id.optional() }),
  label: z.object({ target: id, text: z.string() }),
  study: z.object({ mark_id: count }),
  mark_prepared: z.object({ mode: z.enum(["text", "drawing"]), wall_slot: count }),
  mark_committed: z.object({ mark_id: count, wall_slot: count, kind: z.enum(["text", "drawing"]), witnesses: z.array(id) }),
  mark_abandoned: z.object({ reason: z.enum(["chosen", "death", "slot_taken"]) }),
  leaf_written: z.object({ priest_number: int.positive(), entry_id: count, text: z.string() }),
  leaf_read: z.object({ priest_number: int.positive(), entries: count, query: z.string().optional() }),
  memory_compacted: z.object({ decisions_since_last: count, words: count }),
  meta_leak: z.object({ field: z.enum(["say", "label", "mark", "leaf", "thought"]), word: z.string().min(1), outcome: z.enum(["reasked", "stood_still", "flagged_only"]) }),
  lexicon_new_token: z.object({ token: z.string().min(1), source: TextSource }),
  api_throttle: z.object({ status: int, wait_ms: count, new_rpm: n.nonnegative() }),
  api_outage: z.object({ state: z.enum(["begin", "end"]), duration_s: n.nonnegative().optional() }),
  snapshot_saved: z.object({ path: z.string().min(1), last_seq: count }),
} satisfies Record<EventType, z.ZodTypeAny>;

export const EventPayloadSchemas = Object.fromEntries(EVENT_TYPES.map((t) => [t, P[t].strict()])) as unknown as { [T in EventType]: z.ZodType<z.infer<(typeof P)[T]>> };
export type PayloadOf<T extends EventType> = z.infer<(typeof P)[T]>;

export type TypedEvent = { [T in EventType]: Omit<SimEvent, "type" | "data"> & { type: T; data: PayloadOf<T> } }[EventType];

/** Envelope check plus `data` validated against the payload for its type. */
export const TypedEventSchema = EventSchema.superRefine((e, ctx) => {
  const r = EventPayloadSchemas[e.type].safeParse(e.data);
  if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: ["data", ...issue.path] });
});

export function parseTypedEvent(raw: unknown): TypedEvent {
  return TypedEventSchema.parse(raw) as TypedEvent;
}

import { z } from "zod";
import { EventSchema } from "./events";

/** Server to viewer messages (DESIGN.md section 18). */
const Beat = z.object({ game_day: z.number(), beat: z.number().int() });

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), run_id: z.string(), schema_version: z.number().int(), config_summary: z.record(z.unknown()), current_beat: Beat }),
  z.object({ type: z.literal("world_state"), at: Beat, time_of_day: z.number(), agents: z.array(z.record(z.unknown())), bushes: z.array(z.record(z.unknown())), bodies: z.array(z.record(z.unknown())), objects: z.array(z.record(z.unknown())) }),
  z.object({ type: z.literal("beat_plan"), at: Beat, beat_seconds: z.number().positive(), plans: z.array(z.object({ mind_id: z.string(), act: z.string(), duration_beats: z.number(), path: z.array(z.tuple([z.number(), z.number()])).optional() })) }),
  z.object({ type: z.literal("event"), event: EventSchema }),
  z.object({ type: z.literal("speech"), at: Beat, speaker: z.string(), text: z.string(), volume: z.enum(["whisper", "normal", "loud"]), to: z.string().nullable(), from_stone: z.boolean() }),
  z.object({ type: z.literal("thought"), at: Beat, mind_id: z.string(), text: z.string() }),
  z.object({ type: z.literal("mark_committed"), mark_id: z.number().int(), files: z.object({ json: z.string(), svg: z.string(), png: z.string() }) }),
  z.object({ type: z.literal("leaf_written"), priest_number: z.number().int(), entry_id: z.number().int(), text: z.string() }),
  z.object({ type: z.literal("budget"), calls: z.number(), tokens_in: z.number(), tokens_out: z.number(), rate_rpm: z.number(), health: z.enum(["ok", "throttled", "degraded", "down"]) }),
  z.object({ type: z.literal("banner"), kind: z.enum(["pause", "outage", "circuit_open", "info"]), text: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Viewer to server: control and replay requests only. Nothing else is accepted (no god powers, R6). */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("control"), command: z.enum(["pause", "resume", "speed", "step"]), value: z.number().positive().optional() }),
  z.object({ type: z.literal("request_replay_window"), from_seq: z.number().int().nonnegative(), to_seq: z.number().int().nonnegative() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

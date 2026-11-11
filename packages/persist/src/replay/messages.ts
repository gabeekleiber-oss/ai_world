import { TypedEventSchema, type ServerMessage, type SimEvent, type TypedEvent } from "@ai-world/shared";

export interface MarkFiles {
  json: string;
  svg: string;
  png: string;
}

export interface MessageOptions {
  /** Paths (relative to the run folder) sent with a `mark_committed` message. Default: `cave/marks/<id>.{json,svg,png}`. */
  markFiles?: (markId: number) => MarkFiles;
}

export const defaultMarkFiles = (markId: number): MarkFiles => ({
  json: `cave/marks/${markId}.json`,
  svg: `cave/marks/${markId}.svg`,
  png: `cave/marks/${markId}.png`,
});

/**
 * The server-to-viewer messages one logged event stands for (DESIGN.md section 18): always the `event`
 * itself, then the dedicated `speech`, `leaf_written` or `mark_committed` message a live server sends alongside it.
 *
 * Not derivable from the event log, so never produced here: `world_state` and `beat_plan` (the viewer rebuilds
 * them from events, or asks `stateAt`), `budget`, `banner`, and `thought` (private, kept in thoughts.jsonl; R5).
 * An event whose payload does not match its type still yields its `event` message and nothing else, so one bad
 * line never stops a replay.
 */
export function* eventMessages(event: SimEvent, options: MessageOptions = {}): Generator<ServerMessage> {
  yield { type: "event", event };
  const parsed = TypedEventSchema.safeParse(event);
  if (!parsed.success) return;
  const typed = parsed.data as TypedEvent;
  const at = { game_day: typed.game_day, beat: typed.beat };
  switch (typed.type) {
    case "speech":
      if (typed.actor) {
        yield { type: "speech", at, speaker: typed.actor, text: typed.data.text, volume: typed.data.volume, to: typed.data.to, from_stone: typed.data.from_stone };
      }
      break;
    case "leaf_written":
      yield { type: "leaf_written", priest_number: typed.data.priest_number, entry_id: typed.data.entry_id, text: typed.data.text };
      break;
    case "mark_committed":
      yield { type: "mark_committed", mark_id: typed.data.mark_id, files: (options.markFiles ?? defaultMarkFiles)(typed.data.mark_id) };
      break;
    default:
      break;
  }
}

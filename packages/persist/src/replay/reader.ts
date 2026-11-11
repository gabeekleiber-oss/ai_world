import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ServerMessage, SimEvent, WorldState } from "@ai-world/shared";
import { readEventLog } from "../events/log";
import { SNAPSHOT_DIR, SNAPSHOT_LATEST, listRotatedSnapshots, readSnapshotFile, type Snapshot } from "../snapshot/snapshot";
import { ReplayCursor } from "./cursor";
import { eventMessages, type MessageOptions } from "./messages";

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

export interface ReplayReport {
  eventsPath: string;
  eventCount: number;
  /** First and last sequence numbers found, or -1 for an empty log. */
  firstSeq: number;
  lastSeq: number;
  /** The log ended in a half-written line (a crash). The line is ignored; nothing on disk is changed. */
  truncatedTail: boolean;
  /** Repeated or out-of-order sequence numbers that were ignored. */
  duplicates: number;
  /** Unparseable complete lines in the middle of the file. */
  corrupt: Array<{ line: number; reason: string }>;
  /** Sequence numbers missing between consecutive events, as [firstMissing, lastMissing]. */
  gaps: Array<[number, number]>;
}

/** A run of consecutive events sharing one beat. `start` and `end` index into `events` (end exclusive). */
export interface BeatSpan {
  beat: number;
  game_day: number;
  start: number;
  end: number;
}

/** Where to stop: after the event with this sequence number, or at the start of this beat (before any of its events). */
export type ReplayTarget = { seq: number } | { beat: number } | { end: true };

export interface StateAtOptions {
  /** Same pure reducer the live run and `resumeRun` use. */
  applyEvent: (world: WorldState, event: SimEvent) => WorldState;
  /** Start state when no snapshot is at or before the target. Without it such a seek throws. */
  initial?: () => WorldState;
  /** Start from the nearest earlier snapshot instead of the first event. Default true. */
  useSnapshots?: boolean;
}

export interface ReplayState {
  world: WorldState;
  /** Sequence number of the last event reflected in `world`, or the snapshot's, or -1. */
  lastSeq: number;
  /** "latest", a rotated snapshot name, or null when the state was built from `initial()`. */
  snapshotSource: string | null;
  /** Events applied on top of the starting state. */
  replayed: number;
}

interface KnownSnapshot {
  source: string;
  snapshot: Snapshot;
}

/**
 * A finished (or crashed) run folder, read for replay (DESIGN.md section 15). It is read-only: unlike
 * `resumeRun` it never trims the log or writes a snapshot, so a run can be replayed while it is still being
 * written to, or after a crash, without changing anything. Open it again to pick up newer events.
 *
 * The event log is the source of truth; no model, sim or network is involved.
 */
export class RunReplay {
  readonly runDir: string;
  readonly events: readonly SimEvent[];
  readonly report: ReplayReport;
  readonly beats: readonly BeatSpan[];
  #snapshots: Promise<KnownSnapshot[]> | undefined;

  private constructor(runDir: string, events: readonly SimEvent[], report: ReplayReport) {
    this.runDir = runDir;
    this.events = events;
    this.report = report;
    this.beats = buildBeatSpans(events);
  }

  static async open(runDir: string): Promise<RunReplay> {
    const eventsPath = join(runDir, "events", "events.jsonl");
    const log = await readEventLog(eventsPath);
    const gaps: Array<[number, number]> = [];
    log.events.forEach((event, i) => {
      const previous = log.events[i - 1];
      if (previous && event.seq > previous.seq + 1) gaps.push([previous.seq + 1, event.seq - 1]);
    });
    return new RunReplay(runDir, log.events, {
      eventsPath,
      eventCount: log.events.length,
      firstSeq: log.events[0]?.seq ?? -1,
      lastSeq: log.lastSeq,
      truncatedTail: log.truncatedTail,
      duplicates: log.duplicates,
      corrupt: log.corrupt,
      gaps,
    });
  }

  get length(): number {
    return this.events.length;
  }

  /** Index of the first event with `seq` at or above the given number; `length` if there is none. */
  indexAtSeq(seq: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid]!.seq < seq) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Index of the first event in the first beat at or after `beat`; `length` if there is none. */
  indexAtBeat(beat: number): number {
    return this.beats.find((span) => span.beat >= beat)?.start ?? this.events.length;
  }

  /** Events with `from <= seq <= to`, in order. This is what a viewer's `request_replay_window` asks for. */
  window(fromSeq: number, toSeq: number): SimEvent[] {
    return this.events.slice(this.indexAtSeq(fromSeq), this.indexAtSeq(toSeq + 1));
  }

  /** The events of one beat, or an empty list when nothing happened in it. */
  beat(beat: number): SimEvent[] {
    const span = this.beats.find((s) => s.beat === beat);
    return span ? this.events.slice(span.start, span.end) : [];
  }

  cursor(): ReplayCursor {
    return new ReplayCursor(this);
  }

  /** Messages for the events in `[fromIndex, toIndex)`, in log order, each event followed by any message derived from it. */
  *messages(fromIndex = 0, toIndex = this.events.length, options: MessageOptions = {}): Generator<ServerMessage> {
    for (let i = Math.max(0, fromIndex); i < Math.min(toIndex, this.events.length); i++) yield* eventMessages(this.events[i]!, options);
  }

  /**
   * The `hello` that opens a replayed stream. Reads `config.json` when it is there and has the usual fields;
   * a missing or odd file only makes the summary smaller, because a replay must still open.
   */
  async hello(): Promise<ServerMessage> {
    let raw: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.runDir, "config.json"), "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
    } catch {
      // no usable config.json
    }
    const run = asRecord(raw.run);
    const time = asRecord(raw.time);
    const first = this.events[0];
    const summary: Record<string, unknown> = { replay: true };
    if (typeof run.seed === "number") summary.seed = run.seed;
    if (typeof run.arm === "string") summary.arm = run.arm;
    if (typeof time.beats_per_day === "number") summary.beats_per_day = time.beats_per_day;
    return {
      type: "hello",
      run_id: typeof run.run_id === "string" ? run.run_id : basename(this.runDir),
      schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 1,
      config_summary: summary,
      current_beat: { game_day: first?.game_day ?? 0, beat: first?.beat ?? 0 },
    };
  }

  /**
   * Rebuild the world at a point in the run. Starts from the nearest valid snapshot at or before the target
   * (so scrubbing does not replay from day 0) and applies the events after it. Snapshots that fail their
   * checksum are skipped.
   */
  async stateAt(target: ReplayTarget, options: StateAtOptions): Promise<ReplayState> {
    const endIndex = "seq" in target ? this.indexAtSeq(target.seq + 1) : "beat" in target ? this.indexAtBeat(target.beat) : this.events.length;
    const targetSeq = endIndex === 0 ? -1 : this.events[endIndex - 1]!.seq;

    let base: KnownSnapshot | undefined;
    if (options.useSnapshots ?? true) {
      const known = await this.#knownSnapshots();
      for (let i = known.length - 1; i >= 0; i--) {
        if (known[i]!.snapshot.last_seq <= targetSeq) {
          base = known[i];
          break;
        }
      }
    }
    if (!base && !options.initial) {
      throw new ReplayError("no snapshot at or before the target and no initial() to start from; cannot rebuild the state");
    }

    let world = base ? base.snapshot.world : options.initial!();
    const startIndex = base ? this.indexAtSeq(base.snapshot.last_seq + 1) : 0;
    for (let i = startIndex; i < endIndex; i++) world = options.applyEvent(world, this.events[i]!);
    const replayed = Math.max(0, endIndex - startIndex);
    return {
      world,
      lastSeq: replayed > 0 ? this.events[endIndex - 1]!.seq : base ? base.snapshot.last_seq : -1,
      snapshotSource: base?.source ?? null,
      replayed,
    };
  }

  #knownSnapshots(): Promise<KnownSnapshot[]> {
    this.#snapshots ??= loadKnownSnapshots(join(this.runDir, "world"));
    return this.#snapshots;
  }
}

function buildBeatSpans(events: readonly SimEvent[]): BeatSpan[] {
  const spans: BeatSpan[] = [];
  events.forEach((event, i) => {
    const last = spans[spans.length - 1];
    if (last && last.beat === event.beat) last.end = i + 1;
    else spans.push({ beat: event.beat, game_day: event.game_day, start: i, end: i + 1 });
  });
  return spans;
}

/** Every checksum-valid snapshot in the world folder, oldest first by `last_seq`, one per `last_seq`. */
async function loadKnownSnapshots(worldDir: string): Promise<KnownSnapshot[]> {
  const found: KnownSnapshot[] = [];
  const latest = await readSnapshotFile(join(worldDir, SNAPSHOT_LATEST));
  if (latest.ok) found.push({ source: "latest", snapshot: latest.snapshot });
  for (const name of await listRotatedSnapshots(worldDir)) {
    const check = await readSnapshotFile(join(worldDir, SNAPSHOT_DIR, name));
    if (check.ok) found.push({ source: name, snapshot: check.snapshot });
  }
  found.sort((a, b) => a.snapshot.last_seq - b.snapshot.last_seq);
  return found.filter((s, i) => i === 0 || s.snapshot.last_seq !== found[i - 1]!.snapshot.last_seq);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

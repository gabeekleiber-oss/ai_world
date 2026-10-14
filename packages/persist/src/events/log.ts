import { mkdir, open, readFile, truncate } from "node:fs/promises";
import { dirname } from "node:path";
import { EventSchema, type EventType, type SimEvent } from "@ai-world/shared";

/** A new event before the log assigns its sequence number. */
export interface EventDraft {
  game_day: number;
  beat: number;
  type: EventType;
  actor?: string;
  data?: Record<string, unknown>;
  /** ISO timestamp. Defaults to the log's clock. */
  real_time?: string;
}

export interface EventLogIo {
  /** Append text to the file and make it durable before resolving. Injectable so tests can fail the disk. */
  appendDurable(path: string, text: string): Promise<void>;
}

export const defaultEventLogIo: EventLogIo = {
  async appendDurable(path, text) {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a", 0o666);
    try {
      await handle.writeFile(text, { encoding: "utf8" });
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

export interface ReadEventEntry {
  event: SimEvent;
  /** The original line text without its newline, kept so a log can be trimmed without rewriting history. */
  line: string;
}

export interface ReadEventLogResult {
  entries: ReadEventEntry[];
  events: SimEvent[];
  /** Highest sequence number found, or -1 for an empty log. */
  lastSeq: number;
  /** The file did not end with a newline and its last line was unusable: a write was cut short by a crash. */
  truncatedTail: boolean;
  /** Lines whose sequence number was not above an earlier line. Ignored, which keeps replay idempotent. */
  duplicates: number;
  /** Complete lines in the middle of the file that could not be parsed. Skipped and reported. */
  corrupt: Array<{ line: number; reason: string }>;
}

/** Read events.jsonl tolerantly. A missing file is an empty log. Nothing here modifies the file. */
export async function readEventLog(path: string): Promise<ReadEventLogResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], events: [], lastSeq: -1, truncatedTail: false, duplicates: 0, corrupt: [] };
    throw error;
  }
  const endsClean = text === "" || text.endsWith("\n");
  const lines = text.split("\n");
  if (endsClean) lines.pop();

  const entries: ReadEventEntry[] = [];
  const corrupt: ReadEventLogResult["corrupt"] = [];
  let duplicates = 0;
  let truncatedTail = false;
  let lastSeq = -1;

  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const isFinalUnterminated = !endsClean && index === lines.length - 1;
    let parsed;
    try {
      parsed = EventSchema.safeParse(JSON.parse(line));
    } catch {
      parsed = undefined;
    }
    if (!parsed || !parsed.success) {
      if (isFinalUnterminated) truncatedTail = true;
      else corrupt.push({ line: index + 1, reason: parsed ? parsed.error.issues[0]?.message ?? "invalid event" : "not valid JSON" });
      return;
    }
    if (parsed.data.seq <= lastSeq) {
      duplicates += 1;
      return;
    }
    // A final line that parses but lacks its newline was fully written; keep it.
    lastSeq = parsed.data.seq;
    entries.push({ event: parsed.data, line });
  });
  return { entries, events: entries.map((e) => e.event), lastSeq, truncatedTail, duplicates, corrupt };
}

/** Cut a partial final line left by a crash. Returns true if the file was changed. */
export async function repairEventLogTail(path: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (text === "" || text.endsWith("\n")) return false;
  const keep = Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1), "utf8");
  await truncate(path, keep);
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

export interface EventLogOptions {
  /** Flush buffered events after this many milliseconds. 0 disables the timer (flush each beat yourself). Default 1000. */
  autoFlushMs?: number;
  now?: () => string;
  io?: EventLogIo;
}

/**
 * Append-only event log (DESIGN.md section 15). Events are buffered for at most `autoFlushMs` and must be
 * flushed at every beat end and on shutdown. The log assigns strictly increasing sequence numbers, so
 * replay can skip anything at or below the last applied number.
 */
export class EventLog {
  readonly path: string;
  #nextSeq: number;
  #buffer: string[] = [];
  #bufferedSeqs: number[] = [];
  #durableSeq: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #chain: Promise<void> = Promise.resolve();
  #needsRepair = false;
  #closed = false;
  readonly #autoFlushMs: number;
  readonly #now: () => string;
  readonly #io: EventLogIo;

  private constructor(path: string, lastSeq: number, options: EventLogOptions) {
    this.path = path;
    this.#nextSeq = lastSeq + 1;
    this.#durableSeq = lastSeq;
    this.#autoFlushMs = options.autoFlushMs ?? 1000;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#io = options.io ?? defaultEventLogIo;
  }

  /** Open a log, repairing any partial final line and continuing the sequence after the last valid event. */
  static async open(path: string, options: EventLogOptions = {}): Promise<EventLog> {
    await repairEventLogTail(path);
    const { lastSeq } = await readEventLog(path);
    return new EventLog(path, lastSeq, options);
  }

  /** Highest sequence number handed out so far (buffered or durable), or -1. */
  get lastSeq(): number { return this.#nextSeq - 1; }
  /** Highest sequence number known to be on disk, or -1. */
  get durableSeq(): number { return this.#durableSeq; }
  get pending(): number { return this.#buffer.length; }

  /** Assign the next sequence number and buffer the event. Synchronous so the beat loop never waits on disk. */
  append(draft: EventDraft): SimEvent {
    if (this.#closed) throw new Error("event log is closed");
    const event = EventSchema.parse({
      schema_version: 1,
      seq: this.#nextSeq,
      game_day: draft.game_day,
      beat: draft.beat,
      real_time: draft.real_time ?? this.#now(),
      type: draft.type,
      ...(draft.actor !== undefined ? { actor: draft.actor } : {}),
      data: draft.data ?? {},
    });
    this.#nextSeq += 1;
    this.#buffer.push(JSON.stringify(event));
    this.#bufferedSeqs.push(event.seq);
    this.#armTimer();
    return event;
  }

  /** Write everything buffered and fsync. On failure the events stay buffered and the error is thrown; call again to retry. */
  flush(): Promise<void> {
    this.#clearTimer();
    const run = this.#chain.then(() => this.#flushNow());
    this.#chain = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.flush();
    this.#closed = true;
    this.#clearTimer();
  }

  async #flushNow(): Promise<void> {
    if (this.#buffer.length === 0) return;
    if (this.#needsRepair) {
      await repairEventLogTail(this.path);
      this.#needsRepair = false;
    }
    const lines = this.#buffer.slice();
    const seqs = this.#bufferedSeqs.slice();
    try {
      await this.#io.appendDurable(this.path, lines.join("\n") + "\n");
    } catch (error) {
      // The write may have landed partly. Cut any partial line before the next attempt.
      this.#needsRepair = true;
      this.#armTimer();
      throw error;
    }
    this.#buffer.splice(0, lines.length);
    this.#bufferedSeqs.splice(0, seqs.length);
    this.#durableSeq = seqs[seqs.length - 1] ?? this.#durableSeq;
  }

  #armTimer(): void {
    if (this.#autoFlushMs <= 0 || this.#timer || this.#closed) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.flush().catch(() => undefined);
    }, this.#autoFlushMs);
    this.#timer.unref?.();
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

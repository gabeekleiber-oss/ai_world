import { join } from "node:path";
import { isNewer, type SimEvent, type WorldState } from "@ai-world/shared";
import { writeFileAtomic } from "./fs/atomic";
import { readEventLog, repairEventLogTail } from "./events/log";
import { loadLatestValidSnapshot, writeSnapshot } from "./snapshot/snapshot";

export class ResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeError";
  }
}

export interface ResumeOptions {
  /** Apply one event to the world and return the new world. Must be a pure function of its inputs. */
  applyEvent: (world: WorldState, event: SimEvent) => WorldState;
  /**
   * Fresh world to start from when no snapshot is usable (replays the whole log). Without it, a run with no
   * valid snapshot cannot be resumed and resumeRun throws.
   */
  initial?: () => WorldState;
  /**
   * Drop the events of the last, possibly unfinished beat so it is replayed as a new beat (DESIGN.md section 15 step 4).
   * Default true. Only events after the snapshot are ever dropped.
   */
  discardInFlightBeat?: boolean;
  /** Fix the log on disk (cut a partial last line, remove discarded events). Default true. */
  repairLog?: boolean;
  /**
   * Save a snapshot of the resumed state whenever anything was replayed or discarded. Without it, resuming again
   * before a new snapshot exists would treat the new last beat as unfinished and discard it too. Default true
   * (ignored when repairLog is false).
   */
  snapshotAfterResume?: boolean;
}

export interface ResumeResult {
  world: WorldState;
  extra: Record<string, unknown>;
  /** Highest sequence number reflected in `world`. The next event must use a higher one. -1 if the log is empty. */
  lastSeq: number;
  snapshotSource: string | null;
  snapshotSeq: number;
  rejectedSnapshots: Array<{ source: string; reason: string }>;
  replayed: number;
  /** Events at or below the snapshot sequence, and repeated sequence numbers. Ignored. */
  skippedAlreadyApplied: number;
  duplicates: number;
  corruptLines: Array<{ line: number; reason: string }>;
  truncatedTail: boolean;
  /** Sequence gaps found after the snapshot, as [firstMissing, lastMissing]. Reported, not fatal. */
  gaps: Array<[number, number]>;
  discarded: { beat: number; events: number } | null;
  /** A snapshot of the resumed state was written. */
  snapshotWritten: boolean;
}

/**
 * Rebuild the exact crash state of a run folder: the latest valid snapshot (falling back to older ones
 * when the newest is damaged), then idempotent replay of every event with a higher sequence number.
 * Marks, priest books and minds are reconciled by their own packages from the returned state.
 */
export async function resumeRun(runDir: string, options: ResumeOptions): Promise<ResumeResult> {
  const worldDir = join(runDir, "world");
  const logPath = join(runDir, "events", "events.jsonl");
  const repair = options.repairLog ?? true;

  const loaded = await loadLatestValidSnapshot(worldDir);
  if (!loaded && !options.initial) {
    throw new ResumeError("no valid snapshot in the run folder; cannot resume (a fresh start function is needed to replay from the first event)");
  }
  let world: WorldState = loaded ? loaded.snapshot.world : options.initial!();
  const extra = loaded ? loaded.snapshot.extra : {};
  const snapshotSeq = loaded ? loaded.snapshot.last_seq : -1;

  if (repair) await repairEventLogTail(logPath);
  const log = await readEventLog(logPath);

  const fresh = log.entries.filter((e) => isNewer(e.event, snapshotSeq));
  const skippedAlreadyApplied = log.entries.length - fresh.length;

  let toApply = fresh;
  let discarded: ResumeResult["discarded"] = null;
  if ((options.discardInFlightBeat ?? true) && fresh.length > 0) {
    const lastBeat = Math.max(...fresh.map((e) => e.event.beat));
    const cut = fresh.findIndex((e) => e.event.beat === lastBeat);
    // Only drop a beat that began after the snapshot; never reach back into applied history.
    if (cut >= 0) {
      toApply = fresh.slice(0, cut);
      discarded = { beat: lastBeat, events: fresh.length - cut };
    }
  }

  const gaps: Array<[number, number]> = [];
  let lastSeq = snapshotSeq;
  let replayed = 0;
  for (const { event } of toApply) {
    if (event.seq > lastSeq + 1) gaps.push([lastSeq + 1, event.seq - 1]);
    world = options.applyEvent(world, event);
    lastSeq = event.seq;
    replayed += 1;
  }

  if (discarded && repair) {
    const keepThrough = lastSeq;
    const kept = log.entries.filter((e) => e.event.seq <= keepThrough).map((e) => e.line);
    await writeFileAtomic(logPath, kept.length ? `${kept.join("\n")}\n` : "");
  }

  let snapshotWritten = false;
  if (repair && (options.snapshotAfterResume ?? true) && (replayed > 0 || discarded)) {
    const lastEvent = toApply[toApply.length - 1]?.event;
    await writeSnapshot(worldDir, { last_seq: lastSeq, game_day: lastEvent?.game_day ?? loaded?.snapshot.game_day ?? 0, world, extra });
    snapshotWritten = true;
  }

  return {
    world, extra, lastSeq, snapshotSource: loaded?.source ?? null, snapshotSeq,
    rejectedSnapshots: loaded?.rejected ?? [], replayed, skippedAlreadyApplied,
    duplicates: log.duplicates, corruptLines: log.corrupt, truncatedTail: log.truncatedTail, gaps, discarded, snapshotWritten,
  };
}

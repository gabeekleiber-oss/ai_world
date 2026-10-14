import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SimEvent, WorldState } from "@ai-world/shared";
import { loadConfig } from "@ai-world/shared/node";
import { createWorld, stepPassive } from "../../sim/src";
import { EventLog, readEventLog, repairEventLogTail, type EventLogIo } from "../src/events";
import {
  SNAPSHOT_LATEST, buildSnapshot, listRotatedSnapshots, loadLatestValidSnapshot, parseSnapshot, stableStringify, writeSnapshot,
} from "../src/snapshot";
import { ResumeError, resumeRun } from "../src/resume";
import { writeFileAtomic } from "../src/fs/atomic";

const cfg = loadConfig(resolve(__dirname, "../../.."));
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function tmp(): Promise<string> { const d = await mkdtemp(join(tmpdir(), "ai-world-recovery-")); dirs.push(d); return d; }

/** Test reducer: a beat_start event advances the passive world by one beat. Everything else leaves it unchanged. */
const applyEvent = (w: WorldState, e: SimEvent): WorldState => (e.type === "beat_start" ? (stepPassive(w as never, cfg).world as WorldState) : w);

const draft = (beat: number, type: SimEvent["type"] = "beat_start") => ({ game_day: Math.floor(beat / 40), beat, type });

describe("EventLog", () => {
  it("assigns increasing sequence numbers, buffers until flush, then writes one line per event", async () => {
    const dir = await tmp(); const path = join(dir, "events", "events.jsonl");
    const log = await EventLog.open(path, { autoFlushMs: 0, now: () => "2026-01-01T00:00:00.000Z" });
    const a = log.append({ ...draft(0), data: { n: 1 } });
    const b = log.append({ ...draft(0, "decision"), actor: "mind-1" });
    expect([a.seq, b.seq]).toEqual([0, 1]);
    expect(log.pending).toBe(2);
    expect((await readEventLog(path)).events).toHaveLength(0);
    await log.flush();
    expect(log.pending).toBe(0);
    expect(log.durableSeq).toBe(1);
    const read = await readEventLog(path);
    expect(read.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(read.events[1]).toMatchObject({ actor: "mind-1", type: "decision", schema_version: 1 });
  });

  it("continues the sequence after reopening", async () => {
    const dir = await tmp(); const path = join(dir, "e.jsonl");
    const first = await EventLog.open(path, { autoFlushMs: 0 });
    first.append(draft(0)); first.append(draft(1)); await first.close();
    const second = await EventLog.open(path, { autoFlushMs: 0 });
    expect(second.append(draft(2)).seq).toBe(2);
  });

  it("flushes on its own after the buffer window", async () => {
    const dir = await tmp(); const path = join(dir, "e.jsonl");
    const log = await EventLog.open(path, { autoFlushMs: 20 });
    log.append(draft(0));
    await new Promise((r) => setTimeout(r, 120));
    expect(log.pending).toBe(0);
    expect((await readEventLog(path)).events).toHaveLength(1);
    await log.close();
  });

  it("repairs a partial final line left by a crash, on read and on open", async () => {
    const dir = await tmp(); const path = join(dir, "e.jsonl");
    const log = await EventLog.open(path, { autoFlushMs: 0 });
    log.append(draft(0)); log.append(draft(1)); await log.close();
    await appendFile(path, '{"schema_version":1,"seq":2,"game_d');
    const read = await readEventLog(path);
    expect(read.truncatedTail).toBe(true);
    expect(read.lastSeq).toBe(1);
    expect(await repairEventLogTail(path)).toBe(true);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    const reopened = await EventLog.open(path, { autoFlushMs: 0 });
    expect(reopened.append(draft(2)).seq).toBe(2);
    await reopened.flush();
    const final = await readEventLog(path);
    expect(final.corrupt).toEqual([]);
    expect(final.events.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("keeps a final line that is complete but missing its newline", async () => {
    const dir = await tmp(); const path = join(dir, "e.jsonl");
    const log = await EventLog.open(path, { autoFlushMs: 0 });
    log.append(draft(0)); log.append(draft(1)); await log.close();
    const text = await readFile(path, "utf8");
    await writeFile(path, text.slice(0, -1));
    const read = await readEventLog(path);
    expect(read.truncatedTail).toBe(false);
    expect(read.events).toHaveLength(2);
  });

  it("reports corrupt middle lines and ignores repeated sequence numbers", async () => {
    const dir = await tmp(); const path = join(dir, "e.jsonl");
    const log = await EventLog.open(path, { autoFlushMs: 0 });
    for (let i = 0; i < 3; i++) log.append(draft(i));
    await log.close();
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    await writeFile(path, [lines[0], "garbage", lines[1], lines[1], lines[2]].join("\n") + "\n");
    const read = await readEventLog(path);
    expect(read.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(read.corrupt).toEqual([{ line: 2, reason: "not valid JSON" }]);
    expect(read.duplicates).toBe(1);
  });

  it("treats a missing file as an empty log", async () => {
    const read = await readEventLog(join(await tmp(), "nope.jsonl"));
    expect(read).toMatchObject({ events: [], lastSeq: -1, truncatedTail: false });
  });

  it("keeps events buffered when the disk fails and writes them on retry without duplicates or torn lines", async () => {
    const dir = await tmp(); const path = join(dir, "e.jsonl");
    let failures = 1;
    const io: EventLogIo = {
      async appendDurable(p, text) {
        if (failures-- > 0) { await appendFile(p, text.slice(0, 25)); throw new Error("disk full"); }
        await appendFile(p, text);
      },
    };
    const log = await EventLog.open(path, { autoFlushMs: 0, io });
    log.append(draft(0)); log.append(draft(1));
    await expect(log.flush()).rejects.toThrow("disk full");
    expect(log.pending).toBe(2);
    expect(log.durableSeq).toBe(-1);
    await log.flush();
    expect(log.durableSeq).toBe(1);
    const read = await readEventLog(path);
    expect(read.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(read.corrupt).toEqual([]);
    expect(read.truncatedTail).toBe(false);
  });

  it("rejects an invalid event instead of writing it", async () => {
    const log = await EventLog.open(join(await tmp(), "e.jsonl"), { autoFlushMs: 0 });
    expect(() => log.append({ game_day: 0, beat: -1, type: "beat_start" })).toThrow();
    expect(log.lastSeq).toBe(-1);
  });
});

describe("snapshots", () => {
  it("round-trips with a checksum and detects any change", () => {
    const world = createWorld(cfg) as WorldState;
    const snap = buildSnapshot({ last_seq: 12, game_day: 0, world, extra: { a: 1 } }, () => "t");
    const ok = parseSnapshot(JSON.stringify(snap));
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.snapshot.world).toEqual(world); expect(ok.snapshot.last_seq).toBe(12); expect(ok.snapshot.beat).toBe(world.beat); }
    const tampered = JSON.parse(JSON.stringify(snap)); tampered.world.bodies[0].health = 1;
    expect(parseSnapshot(JSON.stringify(tampered))).toEqual({ ok: false, reason: "checksum mismatch" });
    expect(parseSnapshot(JSON.stringify(snap).slice(0, 200)).ok).toBe(false);
    expect(parseSnapshot("[]").ok).toBe(false);
  });

  it("stable stringify ignores key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(stableStringify({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });

  it("writes latest, rotates the previous one, and prunes to the keep limit", async () => {
    const dir = await tmp();
    let world = createWorld(cfg) as WorldState;
    for (let i = 0; i < 6; i++) {
      await writeSnapshot(dir, { last_seq: i * 10, game_day: 0, world }, { keep: 3 });
      world = stepPassive(world as never, cfg).world as WorldState;
    }
    const latest = await loadLatestValidSnapshot(dir);
    expect(latest?.source).toBe("latest");
    expect(latest?.snapshot.last_seq).toBe(50);
    const rotated = await listRotatedSnapshots(dir);
    expect(rotated).toHaveLength(3);
    expect(rotated.at(-1)).toContain("s0000000041");
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp") || n.startsWith("."))).toEqual([]);
  });

  it("falls back to the previous snapshot when the latest is corrupt", async () => {
    const dir = await tmp();
    let world = createWorld(cfg) as WorldState;
    await writeSnapshot(dir, { last_seq: 10, game_day: 0, world });
    world = stepPassive(world as never, cfg).world as WorldState;
    await writeSnapshot(dir, { last_seq: 20, game_day: 0, world });
    const text = await readFile(join(dir, SNAPSHOT_LATEST), "utf8");
    await writeFile(join(dir, SNAPSHOT_LATEST), text.slice(0, text.length / 2));
    const loaded = await loadLatestValidSnapshot(dir);
    expect(loaded?.snapshot.last_seq).toBe(10);
    expect(loaded?.source).toMatch(/^snapshot-b/);
    expect(loaded?.rejected[0]).toMatchObject({ source: "latest" });
  });

  it("keeps the old latest if the new write fails", async () => {
    const dir = await tmp();
    const world = createWorld(cfg) as WorldState;
    await writeSnapshot(dir, { last_seq: 5, game_day: 0, world });
    let calls = 0;
    const flaky: typeof writeFileAtomic = async (p, d, o) => { if (++calls === 2) throw new Error("rename failed"); return writeFileAtomic(p, d, o); };
    await expect(writeSnapshot(dir, { last_seq: 9, game_day: 0, world }, { writeFile: flaky })).rejects.toThrow("rename failed");
    expect((await loadLatestValidSnapshot(dir))?.snapshot.last_seq).toBe(5);
  });

  it("returns null when nothing is usable", async () => {
    expect(await loadLatestValidSnapshot(await tmp())).toBeNull();
  });
});

describe("resumeRun", () => {
  async function seedRun(beats: number, snapshotAfterBeats: number) {
    const runDir = await tmp();
    const log = await EventLog.open(join(runDir, "events", "events.jsonl"), { autoFlushMs: 0 });
    let world = createWorld(cfg) as WorldState;
    const states: WorldState[] = [world];
    let snapshotWritten = false;
    for (let beat = 0; beat < beats; beat++) {
      const ev = log.append(draft(beat));
      log.append({ ...draft(beat, "decision"), actor: "mind-1" });
      world = applyEvent(world, ev);
      states.push(world);
      if (beat + 1 === snapshotAfterBeats && !snapshotWritten) {
        await log.flush();
        await writeSnapshot(join(runDir, "world"), { last_seq: log.lastSeq, game_day: 0, world });
        snapshotWritten = true;
      }
    }
    await log.close();
    return { runDir, states, log };
  }

  it("rebuilds the state after the last complete beat from snapshot plus replay", async () => {
    const { runDir, states } = await seedRun(10, 4);
    const res = await resumeRun(runDir, { applyEvent });
    expect(res.snapshotSource).toBe("latest");
    expect(res.snapshotSeq).toBe(7);
    // Beat 9 is the in-flight beat and is discarded, so the world matches the state after 9 beats.
    expect(res.discarded).toEqual({ beat: 9, events: 2 });
    expect(res.world).toEqual(states[9]);
    expect(res.lastSeq).toBe(17);
    expect(res.replayed).toBe(10);
    expect(res.snapshotWritten).toBe(true);
    expect(res.gaps).toEqual([]);
  });

  it("can keep the last beat when asked", async () => {
    const { runDir, states } = await seedRun(10, 4);
    const res = await resumeRun(runDir, { applyEvent, discardInFlightBeat: false });
    expect(res.world).toEqual(states[10]);
    expect(res.discarded).toBeNull();
    expect(res.lastSeq).toBe(19);
  });

  it("is idempotent: resuming twice gives the same state, and the log is already trimmed the second time", async () => {
    const { runDir } = await seedRun(10, 4);
    const first = await resumeRun(runDir, { applyEvent });
    const second = await resumeRun(runDir, { applyEvent });
    expect(second.world).toEqual(first.world);
    expect(second.lastSeq).toBe(first.lastSeq);
    expect(second.discarded).toBeNull();
    expect(second.replayed).toBe(0);
    const third = await resumeRun(runDir, { applyEvent });
    expect(third.world).toEqual(first.world);
  });

  it("does not reapply events at or below the snapshot sequence", async () => {
    const { runDir } = await seedRun(6, 6);
    let applied = 0;
    const res = await resumeRun(runDir, { applyEvent: (w, e) => { applied++; return applyEvent(w, e); }, discardInFlightBeat: false });
    expect(applied).toBe(0);
    expect(res.skippedAlreadyApplied).toBe(12);
    expect(res.replayed).toBe(0);
  });

  it("falls back to the previous snapshot when the latest is corrupt, and still reaches the same state", async () => {
    const runDir = await tmp();
    const log = await EventLog.open(join(runDir, "events", "events.jsonl"), { autoFlushMs: 0 });
    let world = createWorld(cfg) as WorldState;
    const states: WorldState[] = [world];
    for (let beat = 0; beat < 8; beat++) {
      world = applyEvent(world, log.append(draft(beat)));
      states.push(world);
      if (beat === 2 || beat === 5) { await log.flush(); await writeSnapshot(join(runDir, "world"), { last_seq: log.lastSeq, game_day: 0, world }); }
    }
    await log.close();
    await writeFile(join(runDir, "world", SNAPSHOT_LATEST), "{ broken");
    const res = await resumeRun(runDir, { applyEvent, discardInFlightBeat: false });
    expect(res.snapshotSource).toMatch(/^snapshot-b/);
    expect(res.rejectedSnapshots[0]?.source).toBe("latest");
    expect(res.snapshotSeq).toBe(2);
    expect(res.world).toEqual(states[8]);
  });

  it("survives a torn final event line", async () => {
    const { runDir, states } = await seedRun(5, 2);
    const logPath = join(runDir, "events", "events.jsonl");
    await appendFile(logPath, '{"schema_version":1,"seq":10,"gam');
    const res = await resumeRun(runDir, { applyEvent, discardInFlightBeat: false });
    expect(res.world).toEqual(states[5]);
    expect((await readFile(logPath, "utf8")).endsWith("\n")).toBe(true);
  });

  it("reports gaps without failing", async () => {
    const runDir = await tmp();
    await mkdir(join(runDir, "events"), { recursive: true });
    const world = createWorld(cfg) as WorldState;
    await writeSnapshot(join(runDir, "world"), { last_seq: 0, game_day: 0, world });
    const mk = (seq: number, beat: number) => JSON.stringify({ schema_version: 1, seq, game_day: 0, beat, real_time: "t", type: "decision", data: {} });
    await writeFile(join(runDir, "events", "events.jsonl"), [mk(0, 0), mk(1, 0), mk(4, 1)].join("\n") + "\n");
    const res = await resumeRun(runDir, { applyEvent, discardInFlightBeat: false });
    expect(res.gaps).toEqual([[2, 3]]);
    expect(res.lastSeq).toBe(4);
  });

  it("replays from the start when no snapshot exists and a fresh world is supplied", async () => {
    const { runDir, states } = await seedRun(4, 99);
    const res = await resumeRun(runDir, { applyEvent, initial: () => createWorld(cfg) as WorldState, discardInFlightBeat: false });
    expect(res.snapshotSource).toBeNull();
    expect(res.world).toEqual(states[4]);
  });

  it("refuses to resume without any snapshot or fresh-world function", async () => {
    const { runDir } = await seedRun(3, 99);
    await expect(resumeRun(runDir, { applyEvent })).rejects.toBeInstanceOf(ResumeError);
  });

  it("resumes cleanly from a snapshot when the event log does not exist yet", async () => {
    const runDir = await tmp();
    const world = createWorld(cfg) as WorldState;
    await writeSnapshot(join(runDir, "world"), { last_seq: -1, game_day: 0, world });
    const res = await resumeRun(runDir, { applyEvent });
    expect(res.world).toEqual(world);
    expect(res.lastSeq).toBe(-1);
  });
});

import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServerMessageSchema, type ServerMessage, type SimEvent, type WorldState } from "@ai-world/shared";
import { loadConfig } from "@ai-world/shared/node";
import { createWorld, stateHash, stepPassive } from "../../sim/src";
import { EventLog } from "../src/events";
import { SNAPSHOT_LATEST, writeSnapshot } from "../src/snapshot";
import { ReplayCursor, ReplayError, RunReplay, eventMessages } from "../src/replay";

const root = resolve(__dirname, "../../..");
const cfg = loadConfig(root);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function tmp(): Promise<string> { const d = await mkdtemp(join(tmpdir(), "ai-world-replay-")); dirs.push(d); return d; }

/** Same toy reducer the recovery tests use: a beat_start event advances the passive world by one beat. */
const applyEvent = (w: WorldState, e: SimEvent): WorldState => (e.type === "beat_start" ? (stepPassive(w as never, cfg).world as WorldState) : w);
const initial = () => createWorld(cfg) as WorldState;

/**
 * Record a live run: `beats` beats of beat_start plus two decisions each, a snapshot every `snapshotEvery` beats.
 * `states[k]` is the world after k beat_start events, which is the state at the start of beat k.
 */
async function recordRun(beats: number, snapshotEvery: number) {
  const runDir = await tmp();
  const log = await EventLog.open(join(runDir, "events", "events.jsonl"), { autoFlushMs: 0, now: () => "2026-01-01T00:00:00.000Z" });
  let world = initial();
  const states: WorldState[] = [world];
  for (let beat = 0; beat < beats; beat++) {
    const day = Math.floor(beat / cfg.time.beats_per_day);
    const start = log.append({ game_day: day, beat, type: "beat_start", data: { phase: "day", awake: ["mind-1", "mind-2"], deciding: ["mind-1", "mind-2"] } });
    log.append({ game_day: day, beat, type: "decision", actor: "mind-1", data: { act: "wait", params: { beats: 1 }, say: null } });
    log.append({ game_day: day, beat, type: "decision", actor: "mind-2", data: { act: "rest", params: {}, say: null } });
    world = applyEvent(world, start);
    states.push(world);
    if ((beat + 1) % snapshotEvery === 0) {
      await log.flush();
      await writeSnapshot(join(runDir, "world"), { last_seq: log.lastSeq, game_day: day, world });
    }
  }
  await log.close();
  return { runDir, states, eventsPath: join(runDir, "events", "events.jsonl") };
}

describe("RunReplay: reading a run folder", () => {
  it("reads events in order with a report, and groups them by beat", async () => {
    const { runDir } = await recordRun(12, 5);
    const replay = await RunReplay.open(runDir);
    expect(replay.length).toBe(36);
    expect(replay.report).toMatchObject({ eventCount: 36, firstSeq: 0, lastSeq: 35, truncatedTail: false, duplicates: 0, corrupt: [], gaps: [] });
    expect(replay.events.map((e) => e.seq)).toEqual(Array.from({ length: 36 }, (_, i) => i));
    expect(replay.beats).toHaveLength(12);
    expect(replay.beats[3]).toEqual({ beat: 3, game_day: 0, start: 9, end: 12 });
  });

  it("an empty or missing log is an empty replay", async () => {
    const replay = await RunReplay.open(await tmp());
    expect(replay.length).toBe(0);
    expect(replay.report.lastSeq).toBe(-1);
    expect(replay.cursor().atEnd).toBe(true);
    expect([...replay.messages()]).toEqual([]);
  });

  it("is read-only: a crashed log with a half-written last line is left exactly as it was", async () => {
    const { runDir, eventsPath } = await recordRun(4, 2);
    await appendFile(eventsPath, '{"schema_version":1,"seq":12,"game_day":0,"beat":4,"real_t');
    const before = await readFile(eventsPath, "utf8");
    const filesBefore = (await readdir(join(runDir, "world"))).sort();
    const replay = await RunReplay.open(runDir);
    expect(replay.report.truncatedTail).toBe(true);
    expect(replay.length).toBe(12);
    expect(await readFile(eventsPath, "utf8")).toBe(before);
    expect((await readdir(join(runDir, "world"))).sort()).toEqual(filesBefore);
  });

  it("reports sequence gaps instead of failing", async () => {
    const runDir = await tmp();
    await mkdir(join(runDir, "events"), { recursive: true });
    const line = (seq: number, beat: number) => JSON.stringify({ schema_version: 1, seq, game_day: 0, beat, real_time: "t", type: "beat_start", data: {} });
    await writeFile(join(runDir, "events", "events.jsonl"), [line(0, 0), line(1, 0), line(5, 1), line(6, 1)].join("\n") + "\n");
    const replay = await RunReplay.open(runDir);
    expect(replay.report.gaps).toEqual([[2, 4]]);
    expect(replay.length).toBe(4);
  });

  it("finds positions by sequence number and by beat, and returns inclusive windows", async () => {
    const { runDir } = await recordRun(10, 5);
    const replay = await RunReplay.open(runDir);
    expect(replay.indexAtSeq(0)).toBe(0);
    expect(replay.indexAtSeq(7)).toBe(7);
    expect(replay.indexAtSeq(10_000)).toBe(replay.length);
    expect(replay.indexAtBeat(4)).toBe(12);
    expect(replay.indexAtBeat(999)).toBe(replay.length);
    expect(replay.window(4, 8).map((e) => e.seq)).toEqual([4, 5, 6, 7, 8]); // what request_replay_window asks for
    expect(replay.window(100, 200)).toEqual([]);
    expect(replay.beat(2).map((e) => e.type)).toEqual(["beat_start", "decision", "decision"]);
    expect(replay.beat(99)).toEqual([]);
  });
});

describe("ReplayCursor", () => {
  it("steps through events, peeks, and goes beat by beat", async () => {
    const { runDir } = await recordRun(5, 5);
    const replay = await RunReplay.open(runDir);
    const cursor = replay.cursor();
    expect(cursor).toBeInstanceOf(ReplayCursor);
    expect(cursor.atStart).toBe(true);
    expect(cursor.peek()?.seq).toBe(0);
    expect(cursor.current).toBeUndefined();
    expect(cursor.next()?.seq).toBe(0);
    expect(cursor.current?.seq).toBe(0);
    expect(cursor.index).toBe(1);
    // mid-beat: nextBeat returns the rest of beat 0, then whole beats
    expect(cursor.nextBeat().map((e) => e.seq)).toEqual([1, 2]);
    expect(cursor.nextBeat().map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(cursor.remaining).toBe(9);
  });

  it("seeks by sequence number and by beat, scrubs backwards, and plays to the end", async () => {
    const { runDir } = await recordRun(6, 3);
    const replay = await RunReplay.open(runDir);
    const cursor = replay.cursor();
    expect(cursor.seekToBeat(4)).toBe(12);
    expect(cursor.peek()).toMatchObject({ beat: 4, type: "beat_start" });
    expect(cursor.seekToSeq(7)).toBe(7);
    expect(cursor.peek()?.seq).toBe(7);
    cursor.seekToBeat(1);
    cursor.rewind();
    expect(cursor.atStart).toBe(true);
    cursor.seekToBeat(5);
    expect([...cursor.play()].map((e) => e.seq)).toEqual([15, 16, 17]);
    expect(cursor.atEnd).toBe(true);
    expect(cursor.next()).toBeUndefined();
    expect(cursor.nextBeat()).toEqual([]);
    cursor.toEnd();
    expect(cursor.atEnd).toBe(true);
  });
});

describe("RunReplay.stateAt: replay reproduces the live run", () => {
  it("matches the live state hash at the start of every beat, with and without snapshots", async () => {
    const { runDir, states } = await recordRun(23, 5);
    const replay = await RunReplay.open(runDir);
    for (let beat = 0; beat <= 23; beat++) {
      const fromSnapshots = await replay.stateAt({ beat }, { applyEvent, initial });
      const fromScratch = await replay.stateAt({ beat }, { applyEvent, initial, useSnapshots: false });
      expect(stateHash(fromSnapshots.world), `beat ${beat} via snapshots`).toBe(stateHash(states[beat]));
      expect(stateHash(fromScratch.world), `beat ${beat} from scratch`).toBe(stateHash(states[beat]));
    }
  });

  it("matches the live final state at the end, and by sequence number", async () => {
    const { runDir, states } = await recordRun(12, 4);
    const replay = await RunReplay.open(runDir);
    expect(stateHash((await replay.stateAt({ end: true }, { applyEvent, initial })).world)).toBe(stateHash(states[12]));
    // seq 3 is the first event of beat 1 (beat_start): the world has advanced one beat
    expect(stateHash((await replay.stateAt({ seq: 3 }, { applyEvent, initial })).world)).toBe(stateHash(states[2]));
    expect(stateHash((await replay.stateAt({ seq: 2 }, { applyEvent, initial })).world)).toBe(stateHash(states[1]));
    expect(stateHash((await replay.stateAt({ seq: -1 }, { applyEvent, initial })).world)).toBe(stateHash(states[0]));
  });

  it("starts from the nearest earlier snapshot, so scrubbing does not replay from the beginning", async () => {
    const { runDir } = await recordRun(23, 5);
    const replay = await RunReplay.open(runDir);
    const late = await replay.stateAt({ beat: 21 }, { applyEvent, initial });
    expect(late.snapshotSource).not.toBeNull();
    expect(late.replayed).toBeLessThan(10);
    const scratch = await replay.stateAt({ beat: 21 }, { applyEvent, initial, useSnapshots: false });
    expect(scratch.snapshotSource).toBeNull();
    expect(scratch.replayed).toBe(63);
    // before the first snapshot there is nothing to start from but initial()
    const early = await replay.stateAt({ beat: 2 }, { applyEvent, initial });
    expect(early.snapshotSource).toBeNull();
  });

  it("skips a damaged snapshot and uses an older one", async () => {
    const { runDir, states } = await recordRun(23, 5);
    const latest = join(runDir, "world", SNAPSHOT_LATEST);
    const text = await readFile(latest, "utf8");
    await writeFile(latest, text.slice(0, text.length / 2));
    const replay = await RunReplay.open(runDir);
    const state = await replay.stateAt({ beat: 23 }, { applyEvent, initial });
    expect(state.snapshotSource).toMatch(/^snapshot-b/);
    expect(stateHash(state.world)).toBe(stateHash(states[23]));
  });

  it("throws a clear error when there is no snapshot and no initial state", async () => {
    const { runDir } = await recordRun(4, 100);
    const replay = await RunReplay.open(runDir);
    await expect(replay.stateAt({ beat: 3 }, { applyEvent })).rejects.toBeInstanceOf(ReplayError);
  });
});

describe("RunReplay.messages: the stream a viewer receives", () => {
  const fixture = resolve(root, "fixtures/ws/two-days.jsonl");
  const fixtureMessages = async (): Promise<ServerMessage[]> => (await readFile(fixture, "utf8")).trim().split("\n").map((l) => ServerMessageSchema.parse(JSON.parse(l)));

  async function runFolderFromFixture(): Promise<string> {
    const runDir = await tmp();
    await mkdir(join(runDir, "events"), { recursive: true });
    const events = (await fixtureMessages()).flatMap((m) => (m.type === "event" ? [m.event] : []));
    await writeFile(join(runDir, "events", "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return runDir;
  }

  it("every message is valid, and replaying the fixture's events reproduces its event, speech, leaf and mark messages", async () => {
    const live = await fixtureMessages();
    const replay = await RunReplay.open(await runFolderFromFixture());
    const replayed = [...replay.messages()];
    for (const m of replayed) expect(ServerMessageSchema.safeParse(m).success).toBe(true);
    for (const type of ["event", "speech", "leaf_written", "mark_committed"] as const) {
      expect(replayed.filter((m) => m.type === type), type).toEqual(live.filter((m) => m.type === type));
    }
    // what a log cannot know is never invented
    for (const type of ["world_state", "beat_plan", "thought", "budget", "banner", "hello"]) expect(replayed.some((m) => m.type === type), type).toBe(false);
  });

  it("puts each derived message right after the event it came from", async () => {
    const replay = await RunReplay.open(await runFolderFromFixture());
    const messages = [...replay.messages()];
    messages.forEach((m, i) => {
      if (m.type === "speech" || m.type === "leaf_written" || m.type === "mark_committed") expect(messages[i - 1]?.type).toBe("event");
    });
  });

  it("can replay a slice, and lets the mark file paths be chosen", async () => {
    const replay = await RunReplay.open(await runFolderFromFixture());
    const slice = [...replay.messages(10, 20)];
    expect(slice.filter((m) => m.type === "event")).toHaveLength(10);
    const markEvent = replay.events.find((e) => e.type === "mark_committed")!;
    const custom = [...eventMessages(markEvent, { markFiles: (id) => ({ json: `m/${id}.json`, svg: `m/${id}.svg`, png: `m/${id}.png` }) })];
    expect(custom[1]).toMatchObject({ type: "mark_committed", files: { json: expect.stringMatching(/^m\/\d+\.json$/) } });
  });

  it("an event with a bad payload still yields its event message and does not stop the stream", () => {
    const bad: SimEvent = { schema_version: 1, seq: 1, game_day: 0, beat: 0, real_time: "t", type: "speech", actor: "mind-1", data: { nonsense: true } };
    const out = [...eventMessages(bad)];
    expect(out).toEqual([{ type: "event", event: bad }]);
  });

  it("builds a hello from config.json when there is one, and still opens without it", async () => {
    const runDir = await runFolderFromFixture();
    const bare = await (await RunReplay.open(runDir)).hello();
    expect(ServerMessageSchema.parse(bare)).toMatchObject({ type: "hello", run_id: basename(runDir), config_summary: { replay: true }, current_beat: { game_day: 0, beat: 0 } });
    await writeFile(join(runDir, "config.json"), JSON.stringify({ schema_version: 1, run: { run_id: "run-42", seed: 7, arm: "B" }, time: { beats_per_day: 40 } }));
    const hello = await (await RunReplay.open(runDir)).hello();
    expect(ServerMessageSchema.parse(hello)).toMatchObject({ run_id: "run-42", config_summary: { replay: true, seed: 7, arm: "B", beats_per_day: 40 } });
    await writeFile(join(runDir, "config.json"), "{ not json");
    expect((await (await RunReplay.open(runDir)).hello()).type).toBe("hello");
  });
});

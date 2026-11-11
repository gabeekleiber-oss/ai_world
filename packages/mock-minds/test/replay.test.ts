import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventType, SimEvent } from "@ai-world/shared";
import { stateHash } from "../../sim/src";
import { EventLog } from "../../persist/src/events";
import { RunReplay } from "../../persist/src/replay";
import { ReplayDataError, ReplayMind, ReplayPolicy, replayMinds, type ReplayVerdict } from "../src/replay";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

let seq = 0;
function ev(beat: number, type: EventType, actor: string | undefined, data: Record<string, unknown>): SimEvent {
  return { schema_version: 1, seq: seq++, game_day: Math.floor(beat / 40), beat, real_time: "t", type, ...(actor ? { actor } : {}), data };
}
const move = (beat: number, actor: string, steps: number) => ev(beat, "decision", actor, { act: "move", params: { heading: "n", steps, gait: "walk" }, say: null });
const wait = (beat: number, actor: string) => ev(beat, "decision", actor, { act: "wait", params: { beats: 1 }, say: null });
const failed = (beat: number, actor: string) => ev(beat, "decision_failed", actor, { reason: "timeout", reasked: false });
const start = (beat: number, deciding: string[]) => ev(beat, "beat_start", undefined, { phase: "day", awake: ["mind-1", "mind-2", "mind-3"], deciding });

function sample(): SimEvent[] {
  seq = 0;
  return [
    start(0, ["mind-1", "mind-2"]), move(0, "mind-1", 8), failed(0, "mind-2"),
    start(1, ["mind-1"]), wait(1, "mind-1"),
    start(2, ["mind-1", "mind-2"]), move(2, "mind-1", 3), // mind-2 was asked at beat 2 but the log stops: a crash cut the beat
  ];
}

describe("ReplayPolicy", () => {
  it("answers decision, failed, missing and none from the recorded events", () => {
    const policy = ReplayPolicy.fromEvents(sample());
    const first = policy.verdict("mind-1", 0);
    expect(first).toMatchObject({ kind: "decision", decision: { act: "move", params: { steps: 8 }, mind_id: "mind-1", beat: 0 } });
    expect(policy.verdict("mind-2", 0)).toMatchObject({ kind: "failed", failure: { reason: "timeout", reasked: false, mind_id: "mind-2" } });
    expect(policy.verdict("mind-2", 2)).toEqual({ kind: "missing" });
    expect(policy.verdict("mind-2", 1)).toEqual({ kind: "none" }); // not asked: mid-action or asleep
    expect(policy.verdict("mind-9", 0)).toEqual({ kind: "none" });
    expect(policy.verdict("mind-1", 50)).toEqual({ kind: "none" });
  });

  it("knows its minds, its span and when it has run out", () => {
    const policy = ReplayPolicy.fromEvents(sample());
    expect(policy.minds).toEqual(["mind-1", "mind-2"]);
    expect([policy.firstBeat, policy.lastBeat]).toEqual([0, 2]);
    expect(policy.isExhausted(2)).toBe(false);
    expect(policy.isExhausted(3)).toBe(true);
    const empty = ReplayPolicy.fromEvents([]);
    expect([empty.firstBeat, empty.lastBeat, empty.minds]).toEqual([-1, -1, []]);
    expect(empty.isExhausted(0)).toBe(true);
  });

  it("lists who was asked at a beat, from beat_start when present and from outcomes otherwise", () => {
    const policy = ReplayPolicy.fromEvents(sample());
    expect(policy.deciding(0)).toEqual(["mind-1", "mind-2"]);
    expect(policy.deciding(1)).toEqual(["mind-1"]);
    expect(policy.deciding(2)).toEqual(["mind-1", "mind-2"]); // asked, even though no outcome was recorded
    seq = 0;
    const noStart = ReplayPolicy.fromEvents([move(5, "mind-3", 1), failed(5, "mind-1")]);
    expect(noStart.deciding(5)).toEqual(["mind-1", "mind-3"]);
    expect(noStart.deciding(6)).toEqual([]);
  });

  it("the later event wins when one mind has two outcomes in a beat, whatever order they arrive in", () => {
    seq = 0;
    const first = move(3, "mind-1", 4);
    const later = failed(3, "mind-1"); // higher seq
    expect(ReplayPolicy.fromEvents([first, later]).verdict("mind-1", 3).kind).toBe("failed");
    expect(ReplayPolicy.fromEvents([later, first]).verdict("mind-1", 3).kind).toBe("failed");
    seq = 0;
    const firstFailed = failed(3, "mind-1");
    const laterMove = move(3, "mind-1", 4);
    expect(ReplayPolicy.fromEvents([laterMove, firstFailed]).verdict("mind-1", 3).kind).toBe("decision");
  });

  it("ignores every other event type", () => {
    seq = 0;
    const policy = ReplayPolicy.fromEvents([start(0, ["mind-1"]), ev(0, "move", "mind-1", { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, gait: "walk", steps: 1 }), ev(0, "speech", "mind-1", { text: "hi", volume: "normal", to: null, from_stone: false, heard_by: [] })]);
    expect(policy.verdict("mind-1", 0)).toEqual({ kind: "missing" });
  });

  it("refuses a malformed decision by default and can skip it on request", () => {
    seq = 0;
    const bad = ev(0, "decision", "mind-1", { act: "not-an-act", params: {}, say: null });
    const noActor = ev(0, "decision_failed", undefined, { reason: "timeout", reasked: false });
    expect(() => ReplayPolicy.fromEvents([bad])).toThrow(ReplayDataError);
    expect(() => ReplayPolicy.fromEvents([noActor])).toThrow(/no actor/);
    const lenient = ReplayPolicy.fromEvents([bad, noActor, move(0, "mind-2", 2)], { onInvalid: "skip" });
    expect(lenient.skipped.map((s) => s.seq)).toEqual([bad.seq, noActor.seq]);
    expect(lenient.verdict("mind-2", 0).kind).toBe("decision");
    expect(lenient.verdict("mind-1", 0).kind).toBe("none");
  });

  it("gives each mind its own view", () => {
    const policy = ReplayPolicy.fromEvents(sample());
    const minds = replayMinds(policy);
    expect([...minds.keys()]).toEqual(["mind-1", "mind-2"]);
    expect(minds.get("mind-1")!.decide(1).kind).toBe("decision");
    expect(new ReplayMind(policy, "mind-2").decide(0).kind).toBe("failed");
    expect(minds.get("mind-2")!.mindId).toBe("mind-2");
  });
});

/**
 * A tiny stand-in for the sim, used only here: each mind has a position, `move` shifts it, `wait` does nothing, and a
 * failed decision leaves it still. It lets this test run "record, then replay" end to end before the real beat loop
 * (SIM-11) exists. The real sim-level replay check is added when that lands.
 */
type Toy = Record<string, { x: number; y: number; failures: number }>;
type Decider = (mind: string, beat: number) => ReplayVerdict;
const MINDS = ["mind-1", "mind-2", "mind-3"];

function runToy(beats: number, decide: Decider, log: EventLog): { world: Toy } {
  const world: Toy = Object.fromEntries(MINDS.map((m) => [m, { x: 0, y: 0, failures: 0 }]));
  for (let beat = 0; beat < beats; beat++) {
    log.append({ game_day: Math.floor(beat / 40), beat, type: "beat_start", data: { phase: "day", awake: MINDS, deciding: MINDS } });
    for (const mind of MINDS) {
      const verdict = decide(mind, beat);
      if (verdict.kind === "decision") {
        const { act, params } = verdict.decision;
        log.append({ game_day: Math.floor(beat / 40), beat, type: "decision", actor: mind, data: { act, params, say: null } });
        if (act === "move") world[mind]!.x += Number(params.steps);
      } else {
        world[mind]!.failures += 1;
        log.append({ game_day: Math.floor(beat / 40), beat, type: "decision_failed", actor: mind, data: { reason: "timeout", reasked: false } });
      }
    }
  }
  return { world };
}

describe("recording a run and replaying it", () => {
  it("replaying a recorded run reproduces the same events and the same state hash, with no decider of its own", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-world-replay-mind-"));
    dirs.push(dir);
    const beats = 120;

    // live run: a scripted decider, including some failures
    const scripted: Decider = (mind, beat): ReplayVerdict => {
      const n = Number(mind.slice(-1)) + beat;
      if (n % 7 === 0) return { kind: "failed", failure: { reason: "timeout", reasked: false, mind_id: mind, beat, game_day: 0, seq: 0 } };
      const act = n % 3 === 0 ? "wait" : "move";
      return { kind: "decision", decision: { act, params: act === "move" ? { heading: "n", steps: (n % 5) + 1, gait: "walk" } : { beats: 1 }, say: null, mind_id: mind, beat, game_day: 0, seq: 0 } };
    };
    const liveLog = await EventLog.open(join(dir, "live", "events", "events.jsonl"), { autoFlushMs: 0, now: () => "t" });
    const live = runToy(beats, scripted, liveLog);
    await liveLog.close();

    // replay: read the folder, build the policy, run again with the recorded decisions only
    const replay = await RunReplay.open(join(dir, "live"));
    const policy = ReplayPolicy.fromEvents(replay.events);
    const minds = replayMinds(policy);
    const replayLog = await EventLog.open(join(dir, "again", "events", "events.jsonl"), { autoFlushMs: 0, now: () => "t" });
    const again = runToy(beats, (mind, beat) => minds.get(mind)!.decide(beat), replayLog);
    await replayLog.close();

    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.world["mind-1"]!.failures).toBeGreaterThan(0); // the script really did produce failures
    const replayed = await RunReplay.open(join(dir, "again"));
    expect(replayed.events).toEqual(replay.events);
    expect(policy.isExhausted(beats)).toBe(true);
  });
});

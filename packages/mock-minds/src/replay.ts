import { EventPayloadSchemas, type PayloadOf, type SimEvent } from "@ai-world/shared";

/**
 * Replay policy (DESIGN.md section 10, "mock minds": replay reads actions from a prior run's log).
 *
 * It answers one question for the simulation, with no model and no network: "at this beat, what did this mind
 * do in the recorded run?" It is built from the recorded events only. Feed it `RunReplay.events` from
 * `@ai-world/persist` (or any list of events) and run the sim with the same seed and config.
 *
 * What it returns is the recorded engine-level action (`act` plus `params`, with engine ids), exactly as the
 * `decision` event stored it, not a prompt-level decision with handles. Turning it into whatever the sim's
 * `Mind` interface (SIM-11) wants is the job of a thin adapter on that interface.
 *
 * Thoughts are never part of an event (R5), so a replay has none.
 */

interface Where {
  mind_id: string;
  beat: number;
  game_day: number;
  seq: number;
}

/** A recorded `decision` event. */
export type RecordedDecision = PayloadOf<"decision"> & Where;
/** A recorded `decision_failed` event: the mind stood still this beat, for this reason. */
export type RecordedFailure = PayloadOf<"decision_failed"> & Where;

export type ReplayVerdict =
  /** Apply this action. */
  | { kind: "decision"; decision: RecordedDecision }
  /** The mind was asked and produced nothing usable. Stand still, as the original run did. */
  | { kind: "failed"; failure: RecordedFailure }
  /** The mind was asked for a decision this beat but nothing was recorded, because the log stops here (for example a crash cut the beat). */
  | { kind: "missing" }
  /** The mind was not asked this beat: it was mid-action, asleep or not yet born. */
  | { kind: "none" };

export class ReplayDataError extends Error {
  readonly seq: number;
  constructor(seq: number, message: string) {
    super(`event ${seq}: ${message}`);
    this.name = "ReplayDataError";
    this.seq = seq;
  }
}

export interface ReplayPolicyOptions {
  /** What to do with a decision event that has no actor or a payload that does not match its type. Default "throw". */
  onInvalid?: "throw" | "skip";
}

type Entry = { seq: number; verdict: Extract<ReplayVerdict, { kind: "decision" | "failed" }> };

/** Recorded actions, indexed by beat and mind. Immutable once built. */
export class ReplayPolicy {
  readonly firstBeat: number;
  readonly lastBeat: number;
  readonly minds: readonly string[];
  /** Events that were skipped under `onInvalid: "skip"`. Always empty under "throw". */
  readonly skipped: ReadonlyArray<{ seq: number; reason: string }>;
  readonly #entries: Map<string, Entry>;
  readonly #deciding: Map<number, ReadonlySet<string>>;

  private constructor(entries: Map<string, Entry>, deciding: Map<number, ReadonlySet<string>>, minds: Set<string>, beats: number[], skipped: Array<{ seq: number; reason: string }>) {
    this.#entries = entries;
    this.#deciding = deciding;
    this.minds = [...minds].sort();
    this.firstBeat = beats.length ? Math.min(...beats) : -1;
    this.lastBeat = beats.length ? Math.max(...beats) : -1;
    this.skipped = skipped;
  }

  /**
   * Build from recorded events. If one mind has both a `decision` and a `decision_failed` event in the same beat,
   * the later one (higher `seq`) is the outcome.
   */
  static fromEvents(events: Iterable<SimEvent>, options: ReplayPolicyOptions = {}): ReplayPolicy {
    const strict = (options.onInvalid ?? "throw") === "throw";
    const entries = new Map<string, Entry>();
    const deciding = new Map<number, ReadonlySet<string>>();
    const minds = new Set<string>();
    const beats: number[] = [];
    const skipped: Array<{ seq: number; reason: string }> = [];

    const reject = (seq: number, reason: string): void => {
      if (strict) throw new ReplayDataError(seq, reason);
      skipped.push({ seq, reason });
    };

    for (const event of events) {
      beats.push(event.beat);
      if (event.type === "beat_start") {
        const parsed = EventPayloadSchemas.beat_start.safeParse(event.data);
        if (!parsed.success) {
          reject(event.seq, `beat_start payload is not valid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
          continue;
        }
        if (!deciding.has(event.beat)) deciding.set(event.beat, new Set(parsed.data.deciding));
        continue;
      }
      if (event.type !== "decision" && event.type !== "decision_failed") continue;
      if (!event.actor) {
        reject(event.seq, `${event.type} has no actor`);
        continue;
      }
      const where: Where = { mind_id: event.actor, beat: event.beat, game_day: event.game_day, seq: event.seq };
      let verdict: Entry["verdict"];
      if (event.type === "decision") {
        const parsed = EventPayloadSchemas.decision.safeParse(event.data);
        if (!parsed.success) {
          reject(event.seq, `decision payload is not valid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
          continue;
        }
        verdict = { kind: "decision", decision: { ...parsed.data, ...where } };
      } else {
        const parsed = EventPayloadSchemas.decision_failed.safeParse(event.data);
        if (!parsed.success) {
          reject(event.seq, `decision_failed payload is not valid: ${parsed.error.issues[0]?.message ?? "unknown"}`);
          continue;
        }
        verdict = { kind: "failed", failure: { ...parsed.data, ...where } };
      }
      minds.add(event.actor);
      const key = keyOf(event.beat, event.actor);
      const existing = entries.get(key);
      if (!existing || event.seq > existing.seq) entries.set(key, { seq: event.seq, verdict });
    }
    return new ReplayPolicy(entries, deciding, minds, beats, skipped);
  }

  /** What the recorded run did for this mind at this beat. */
  verdict(mindId: string, beat: number): ReplayVerdict {
    const entry = this.#entries.get(keyOf(beat, mindId));
    if (entry) return entry.verdict;
    return this.#deciding.get(beat)?.has(mindId) ? { kind: "missing" } : { kind: "none" };
  }

  /** The minds the recorded run asked for a decision at this beat, sorted. Falls back to the minds that have a recorded outcome when the beat has no `beat_start`. */
  deciding(beat: number): string[] {
    const listed = this.#deciding.get(beat);
    if (listed) return [...listed].sort();
    return this.minds.filter((m) => this.#entries.has(keyOf(beat, m)));
  }

  /** True once the log has nothing more to give: the beat is after the last recorded one. */
  isExhausted(beat: number): boolean {
    return beat > this.lastBeat;
  }
}

/** One mind's view of a policy. */
export class ReplayMind {
  readonly mindId: string;
  readonly #policy: ReplayPolicy;

  constructor(policy: ReplayPolicy, mindId: string) {
    this.#policy = policy;
    this.mindId = mindId;
  }

  decide(beat: number): ReplayVerdict {
    return this.#policy.verdict(this.mindId, beat);
  }
}

/** A `ReplayMind` for every mind that appears in the recording, by mind id. */
export function replayMinds(policy: ReplayPolicy): Map<string, ReplayMind> {
  return new Map(policy.minds.map((id) => [id, new ReplayMind(policy, id)]));
}

function keyOf(beat: number, mindId: string): string {
  return `${beat}\u0000${mindId}`;
}

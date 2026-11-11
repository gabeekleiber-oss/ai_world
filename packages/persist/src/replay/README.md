# Replay reader (PER-06)

Reads a run folder as an ordered event and message stream, with no model and no network (DESIGN.md section 15, "Replay"). The matching policy that feeds recorded decisions back into a sim is `packages/mock-minds/src/replay.ts`.

```ts
const replay = await RunReplay.open(runDir);          // read-only; never trims the log or writes a snapshot
replay.events; replay.report; replay.beats;           // ordered events, what was found, beat boundaries
replay.window(fromSeq, toSeq);                        // inclusive, what a viewer's request_replay_window asks for
const cursor = replay.cursor();                       // next, peek, nextBeat, seekToBeat, seekToSeq, rewind, play
for (const message of replay.messages()) send(message);
const world = await replay.stateAt({ beat: 120 }, { applyEvent, initial });
```

## What you get

- **Tolerant reading.** A half-written last line (a crash) is ignored and reported in `report.truncatedTail`. Repeated or out-of-order sequence numbers, unreadable lines and sequence gaps are counted in the report. Nothing on disk is changed, so a run can be replayed while it is still being written, or after it crashed.
- **Seeking.** By sequence number (`indexAtSeq`, `seekToSeq`) or by beat (`indexAtBeat`, `seekToBeat`). `beat` is the global beat number, as in the events.
- **Messages.** `messages()` turns events into `ServerMessage`s: every event as an `event` message, followed by the `speech`, `leaf_written` or `mark_committed` message a live server sends with it. `hello()` opens a stream (from `config.json` when it has the usual fields). Never produced, because a log cannot know them: `world_state`, `beat_plan`, `budget`, `banner`, and `thought` (private, in `thoughts.jsonl`, R5). A viewer rebuilds world state with `stateAt`, or from the events. Mark file paths default to `cave/marks/<id>.{json,svg,png}` and can be changed with `markFiles`.
- **State at any point.** `stateAt({ beat })` is the world at the start of that beat; `{ seq }` is the world after that event; `{ end: true }` is the final world. It starts from the nearest earlier checksum-valid snapshot (damaged ones are skipped) and applies only the events after it, so scrubbing does not replay from day 0. `useSnapshots: false` forces a replay from `initial()`, which is how the two paths are checked against each other.

`applyEvent` must be the same pure reducer the live run and `resumeRun` use. That is the contract that makes a replayed state hash equal the live one.

## Replay policy (`packages/mock-minds/src/replay.ts`)

`ReplayPolicy.fromEvents(replay.events)` answers "what did this mind do at this beat in the recorded run?" with one of `decision` (the recorded `act` and `params`, engine ids as stored), `failed` (the mind was asked and stood still), `missing` (asked, but the log stops there) or `none` (not asked: mid-action, asleep, not yet born). `ReplayMind` is one mind's view. It depends only on `@ai-world/shared`.

## Not done yet

The sim's `Mind` interface and beat loop (SIM-11) do not exist yet, so the policy returns its own verdict type instead of implementing `Mind`, and the check "replaying a recorded sim run gives the same state hash" cannot run against the real sim. What is tested now: replay reproduces the live state hash at every beat using the passive-world reducer (with and without snapshots), and a recorded run replayed through `ReplayMind` into a small stand-in sim gives identical events and the same hash. When SIM-11 and SIM-13 land, add the adapter from `ReplayVerdict` to `Mind` and a real-sim replay test (PER-08 covers the crash side).

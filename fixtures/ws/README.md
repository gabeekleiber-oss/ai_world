# WebSocket fixtures

`two-days.jsonl` is a scripted two-game-day stream (80 beats) of server-to-viewer messages, one JSON message per line, in the order a live server would send them. Viewer, persistence and observatory work can use it with no sim running.

It contains every message type: `hello`, `world_state` (beats 0, 20, 40, 60, 79), `beat_plan` every beat, typed `event`s (move, pick, eat, speech, gathering_speech, mark_prepared, mark_committed, leaf_written, death, arrival), `speech` including one from the stone, `thought`, `mark_committed`, `leaf_written`, `budget`, and an outage `banner` pair.

Not engine output: movement is a plain walk toward goals at 8 steps per beat, needs are rough, and the arrival (beat 77) comes 7 beats after the death instead of the real 3-day delay. Do not use it to check sim behavior.

Regenerate with `npx tsx fixtures/ws/generate.ts`. The test `tests/fixtures-ws.test.ts` validates every line against `ServerMessageSchema` and the typed event payloads, and fails if the file drifts from the generator.

# Event log, snapshots and resume (PER-02)

Covers `src/events/`, `src/snapshot/` and `src/resume.ts`. DESIGN.md section 15 is the spec.

- `EventLog.open(path)` repairs a partial final line, then continues the sequence. `append(draft)` assigns the next `seq` and buffers; call `flush()` at every beat end and on shutdown (it writes one batch and fsyncs; a 1 s timer is the backstop). If the disk fails, events stay buffered and the next `flush()` cuts any torn line before retrying, so nothing is lost or doubled.
- `readEventLog(path)` is tolerant: a torn last line is reported as `truncatedTail`, unreadable middle lines go to `corrupt`, and repeated or out-of-order sequence numbers are counted in `duplicates` and ignored.
- `writeSnapshot(worldDir, { last_seq, game_day, world, extra })` copies the previous valid `snapshot-latest.json` into `snapshots/` and then atomically replaces latest, so a crash at any point leaves a valid snapshot. Every snapshot carries a sha256 checksum over a key-order-independent form. `keep` (default 10) bounds the rotated files.
- `loadLatestValidSnapshot(worldDir)` tries latest, then rotated snapshots newest first, and reports what it rejected and why.
- `resumeRun(runDir, { applyEvent, initial? })` loads the best snapshot, then replays only events with `seq` above the snapshot's `last_seq`. Replay is idempotent. By default the last beat in the log is treated as unfinished: its events are dropped (and cut from the file) so it replays as a new beat, and a fresh snapshot is written so a second resume does not discard another beat.

Not covered here (other tasks): reconciling marks and priest books with world counters (PER-03/04, SIM-13) and rebuilding minds from `memory.jsonl` (PER-08).

Limitation: a clean shutdown looks the same as a crash, so the final beat is always replayed as new.

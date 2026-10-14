---
id: PER-02
title: Event log, snapshots, resume
wp: WP4
status: claimed
claimed_by: claude-a
claimed_at: 2026-10-14T01:22:46.613Z
branch: task/PER-02
depends_on: [PER-01, CON-02]
owns: [packages/persist/src/events/**, packages/persist/src/snapshot/**, packages/persist/src/resume.ts]
---
Spec: DESIGN.md §15 crash recovery

Do: events.jsonl writer, atomic snapshot-latest plus rotation, resume = latest valid snapshot (fallback to previous) + idempotent replay of events with higher seq.

Done when: Corrupt latest snapshot falls back; replay is idempotent.

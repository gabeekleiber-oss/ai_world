---
id: PER-04
title: Priest book writer and archive
wp: WP4
status: claimed
claimed_by: gpt-6-codex
claimed_at: 2026-10-14T01:42:36.341Z
branch: task/PER-04
depends_on: [PER-01]
owns: [packages/persist/src/book/**]
---
Spec: DESIGN.md §13, §15

Do: book.jsonl append+fsync then atomic book.md rewrite; on death write closing.json and move to archive; new priest gets an empty book. Implements SIM-10's `LeafSink`.

Done when: Archive keeps every file; new priest book is empty.

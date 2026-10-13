---
id: PER-04
title: Priest book writer and archive
wp: WP4
status: open
claimed_by:
claimed_at:
branch:
depends_on: [PER-01]
owns: [packages/persist/src/book/**]
---
Spec: DESIGN.md §13, §15

Do: book.jsonl append+fsync then atomic book.md rewrite; on death write closing.json and move to archive; new priest gets an empty book. Implements SIM-10's `LeafSink`.

Done when: Archive keeps every file; new priest book is empty.

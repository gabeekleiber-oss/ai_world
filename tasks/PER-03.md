---
id: PER-03
title: Mark writer and gallery
wp: WP4
status: claimed
claimed_by: claude-chat
claimed_at: 2026-11-11T14:19:27.536Z
branch: task/PER-03
depends_on: [PER-01]
owns: [packages/persist/src/marks/**]
---
Spec: DESIGN.md §12 persistence on commit, §15

Do: On commit write record JSON, SVG, PNG preview, marks.jsonl, then fsync, then report success. Retry on failure. Static gallery.html regenerated. Implements SIM-10's `MarkSink`.

Done when: Failing disk is retried and never reports success early; gallery lists all marks.

---
id: PER-05
title: Mind log writers
wp: WP4
status: open
claimed_by:
claimed_at:
branch:
depends_on: [PER-01]
owns: [packages/persist/src/minds/**]
---
Spec: DESIGN.md §15 minds/

Do: Per-mind profile.json, calls.jsonl, thoughts.jsonl, memory.jsonl, speech.jsonl writers with per-beat flush.

Done when: Files appear under minds/<id>/ with schema_version; thoughts never written anywhere else.

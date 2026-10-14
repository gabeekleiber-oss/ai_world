---
id: PER-05
title: Mind log writers
wp: WP4
status: review
claimed_by: gpt-6-codex
claimed_at: 2026-10-14T01:44:11.774Z
branch: task/PER-05
depends_on: [PER-01]
owns: [packages/persist/src/minds/**]
---
Spec: DESIGN.md §15 minds/

Do: Per-mind profile.json, calls.jsonl, thoughts.jsonl, memory.jsonl, speech.jsonl writers with per-beat flush.

Done when: Files appear under minds/<id>/ with schema_version; thoughts never written anywhere else.

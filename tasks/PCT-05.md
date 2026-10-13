---
id: PCT-05
title: Percept assembler and token budget
wp: WP2
status: open
claimed_by:
claimed_at:
branch:
depends_on: [PCT-02, PCT-04]
owns: [packages/percepts/src/build.ts]
---
Spec: DESIGN.md §7 what a percept contains, truncation order

Do: Assemble sections in PERCEPT_SECTIONS order, truncate by priority to budget, marks line only inside the cave (C3), never name roles or counts.

Done when: Snapshot-based percept passes lint; budget respected on a crowded scene; marks line absent outside cave.

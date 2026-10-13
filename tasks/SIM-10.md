---
id: SIM-10
title: Mark and leaf engine actions
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-07, CON-02]
owns: [packages/sim/src/actions/marks.ts, packages/sim/src/actions/leaves.ts]
---
Spec: DESIGN.md §8, §12, §13

Do: mark_prepare/commit/abandon, study_mark, leaf_write/leaf_read, slot snapping, contention, death-before-commit. Persistence is an injected interface (`MarkSink`, `LeafSink`) that must succeed before charge is spent (R8).

Done when: Tests with a failing sink prove no charge on write failure; 2-mark cap; kit-only leaf actions.

---
id: SIM-07
title: Movement, wait, rest, sleep, continuation
wp: WP1
status: review
claimed_by: claude-a
claimed_at: 2026-10-14T01:12:53.670Z
branch: task/SIM-07
depends_on: [SIM-02, SIM-03, SIM-06]
owns: [packages/sim/src/actions/move.ts, packages/sim/src/actions/rest.ts, packages/sim/src/continuation.ts]
---
Spec: DESIGN.md §8 move/turn/wait/rest, continuation and interrupts, §11 movement

Do: Resolve move/turn/wait/rest, walk/run speeds, cliff soft boundary, sleep wake triggers, multi-beat continuation with the interrupt list.

Done when: Tests: speeds, run fatigue, interrupt re-ask conditions, forced sleep at fatigue 100.

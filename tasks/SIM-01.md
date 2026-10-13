---
id: SIM-01
title: Sim package scaffold, seeded RNG, state hash
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: []
owns: [packages/sim/package.json, packages/sim/src/rng.ts, packages/sim/src/hash.ts, packages/sim/src/index.ts, packages/sim/README.md]
---
Spec: DESIGN.md §4, §11 determinism

Do: Create packages/sim (workspace, tsconfig, vitest). Seeded RNG that logs every outcome-affecting draw. Stable state hash function.

Done when: Same seed gives same draws and hash; draw log is exportable; register package in root tsconfig.

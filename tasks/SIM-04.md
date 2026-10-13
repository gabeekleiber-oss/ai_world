---
id: SIM-04
title: Slots, kit and temperament draw (D13)
wp: WP1
status: done
claimed_by: wp1a
claimed_at:
branch:
depends_on: [SIM-01]
owns: [packages/sim/src/slots/**]
---
Spec: DESIGN.md §3 D13, §6

Do: Slots with independent kit and temperament axes. `seeded_any`, `regular_only`, `priest_only`, `fixed:<slot>`, `none` modes. Draw recorded for config.json.

Done when: Over 1,000 seeds the draw is about uniform across slots; every mode tested.

Completed in commit 3da5a36 (WP1a): packages/sim/src/temperament.ts (drawMaliciousSlot; config modes are seeded_any, plain_only, none).

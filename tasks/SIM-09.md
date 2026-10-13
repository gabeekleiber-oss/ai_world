---
id: SIM-09
title: Hit, push, death, still body, bones
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-07]
owns: [packages/sim/src/actions/combat.ts, packages/sim/src/death.ts]
---
Spec: DESIGN.md §8, §11 combat and bodies

Do: Hit/push resolution with hit chances, damage formula, stagger, reach 2, death at health 0, still body 120 beats then bones. Respect `hit` disable switch (D11).

Done when: Tests reproduce §19 aggressor numbers on fixed seeds (8-14 beats to kill).

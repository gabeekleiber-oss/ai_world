---
id: SIM-08
title: Pick, eat, drop, give, take, drag
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-05, SIM-07]
owns: [packages/sim/src/actions/items.ts]
---
Spec: DESIGN.md §8 table, §11 take contest, drag speed

Do: Item actions with feasibility checks and in-world failure results (use ids, text comes from percepts).

Done when: Carry cap 6; take contest vs sleeping/still; drag speed 3; every failure returns a result code.

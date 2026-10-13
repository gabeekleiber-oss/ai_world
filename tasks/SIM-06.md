---
id: SIM-06
title: Beat clock and light
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-01]
owns: [packages/sim/src/clock/**]
---
Spec: DESIGN.md §5 time and light, §11 light

Do: Beat to day/phase mapping, dawn/day/dusk/night, `sky_cycle` irregular option stub, vision radius by light.

Done when: Phase boundaries match §11; clock state is serializable.

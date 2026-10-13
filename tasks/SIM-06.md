---
id: SIM-06
title: Beat clock and light
wp: WP1
status: done
claimed_by: wp1a
claimed_at:
branch:
depends_on: [SIM-01]
owns: [packages/sim/src/clock/**]
---
Spec: DESIGN.md §5 time and light, §11 light

Do: Beat to day/phase mapping, dawn/day/dusk/night, `sky_cycle` irregular option stub, vision radius by light.

Done when: Phase boundaries match §11; clock state is serializable.

Completed in commit 3da5a36 (WP1a): packages/sim/src/clock.ts (the irregular sky_cycle option is not implemented; add it under SIM-11 or a new task if wanted).

---
id: SIM-02
title: Terrain and landmark placement
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-01]
owns: [packages/sim/src/terrain/**]
---
Spec: DESIGN.md §5 landmarks table, §6 starting setup

Do: Seeded heightmap, hall, cave, pond, 7 bushes in 3 clusters, starting clearing, cliff boundary. Enforce all placement constraints, including a bush within 40 m of the clearing.

Done when: Property test over 500 seeds: every placement rule holds. Terrain regenerates from seed.

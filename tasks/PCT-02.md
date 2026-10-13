---
id: PCT-02
title: Visibility and hearing geometry
wp: WP2
status: open
claimed_by:
claimed_at:
branch:
depends_on: [PCT-01, SIM-02]
owns: [packages/percepts/src/senses/**]
---
Spec: DESIGN.md §7 sensing rules table

Do: Sight cone and radii by light, occlusion by terrain/hall/cave, hearing radii (whisper/normal/loud/stone), egocentric bearings, distance rounding.

Done when: Unit tests for every row of the §7 table and the rounding rule.

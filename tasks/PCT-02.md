---
id: PCT-02
title: Visibility and hearing geometry
wp: WP2
status: claimed
claimed_by: claude-a
claimed_at: 2026-10-14T01:18:29.218Z
branch: task/PCT-02
depends_on: [PCT-01, SIM-02]
owns: [packages/percepts/src/senses/**]
---
Spec: DESIGN.md §7 sensing rules table

Do: Sight cone and radii by light, occlusion by terrain/hall/cave, hearing radii (whisper/normal/loud/stone), egocentric bearings, distance rounding.

Done when: Unit tests for every row of the §7 table and the rounding rule.

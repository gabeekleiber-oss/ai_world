---
id: SIM-03
title: Bodies, needs, age curve, appearance
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-01]
owns: [packages/sim/src/body/**]
---
Spec: DESIGN.md §6 body state, §11 hunger/fatigue/health

Do: Per-beat decay and regen for satiety, fatigue, health, age; vigor curve; seeded strength/speed 0.85-1.15; appearance generation.

Done when: Unit tests match the §11 table numbers (starve timing, sleep 12-13 beats, vigor at day 60/100).

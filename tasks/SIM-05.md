---
id: SIM-05
title: Berries and bushes
wp: WP1
status: done
claimed_by: wp1a
claimed_at:
branch:
depends_on: [SIM-02]
owns: [packages/sim/src/berries/**]
---
Spec: DESIGN.md §5 berries, §11 berries

Do: Capacity, regrowth, stripped-bush dormancy and half-rate, spoilage of picked berries.

Done when: Unit tests for each §11 berry row; bushes never go permanently empty under foraging.

Completed in commit 3da5a36 (WP1a): packages/sim/src/berries.ts.

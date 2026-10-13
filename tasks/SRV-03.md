---
id: SRV-03
title: Gate 1 determinism test
wp: WP10
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SRV-02, PER-08]
owns: [tests/gate1/**]
---
Spec: DESIGN.md §18 Gate 1

Do: Automate Gate 1: 100-day mock run under ~2 min, same seed gives same hash, replay equals live.

Done when: Passes in CI.

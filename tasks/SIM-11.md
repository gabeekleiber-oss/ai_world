---
id: SIM-11
title: Beat loop, resolution order, event emission
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-08, SIM-09, SIM-10, CON-02]
owns: [packages/sim/src/beat.ts, packages/sim/src/events.ts]
---
Spec: DESIGN.md §10 beat scheduler, §11 order of resolution

Do: Orchestrate one beat: continuing actions and decay, collect decisions via an injected `Mind` interface, seeded-order resolution per §11, deaths, event records with seq numbers, idempotent apply.

Done when: Headless loop with a trivial mind runs 100 days; same seed gives same hash.

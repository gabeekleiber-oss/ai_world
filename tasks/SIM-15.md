---
id: SIM-15
title: Engine invariant property tests
wp: WP10
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-11]
owns: [packages/sim/test/properties/**]
---
Spec: DESIGN.md §19 test layers

Do: Random valid decisions never crash or break invariants: satiety bounds, one-mark rule, carry limit, no negative health, seq monotonic.

Done when: fast-check (or equivalent) suite passes in CI.

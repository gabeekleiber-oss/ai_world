---
id: PCT-01
title: Percepts scaffold, handles, known places
wp: WP2
status: open
claimed_by:
claimed_at:
branch:
depends_on: []
owns: [packages/percepts/package.json, packages/percepts/src/handles.ts, packages/percepts/src/places.ts, packages/percepts/src/index.ts, packages/percepts/README.md]
---
Spec: DESIGN.md §6 handles, §7 handles and spatial memory

Do: New package. Per-agent stable handles (thing-N, other-N, place-N), first-meeting order, known-places list with last-seen, `label` support.

Done when: Handles stable per mind and never shared; tests for ordering and relabel.

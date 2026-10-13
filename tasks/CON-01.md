---
id: CON-01
title: World and agent state types
wp: WP0
status: review
claimed_by: claude-main
claimed_at: 2026-10-13T23:30:52.681Z
branch: task/CON-01
depends_on: []
owns: [packages/shared/src/state.ts, packages/shared/test/state.test.ts]
---
Spec: DESIGN.md §5, §6, §11

Do: Zod schemas+types: Body (all stats), AgentState (slot, kit, temperament, mind id, lifecycle state, carrying, marks left), Bush, WorldState, ClockState, Slot/Kit/Temperament enums. Export from index.ts.

Done when: Types compile, schemas round-trip a sample state, `npm run check` green.

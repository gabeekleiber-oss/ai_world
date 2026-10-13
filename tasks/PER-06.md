---
id: PER-06
title: Replay reader and replay mind policy
wp: WP4
status: open
claimed_by:
claimed_at:
branch:
depends_on: [PER-02]
owns: [packages/persist/src/replay/**, packages/mock-minds/src/replay.ts]
---
Spec: DESIGN.md §15 replay, §10 mock minds

Do: Read a run folder as an ordered ServerMessage/event stream with seek; a replay mock policy that feeds recorded actions into the sim.

Done when: Replaying a recorded mock run reproduces the same state hash.

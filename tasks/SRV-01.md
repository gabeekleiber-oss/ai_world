---
id: SRV-01
title: Server wiring and WebSocket
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-11, PCT-05, GW-06, PER-02]
owns: [packages/server/**]
---
Spec: DESIGN.md §4, §18 protocol

Do: Wire sim + percepts + gateway + persist; WS server on localhost emitting hello, world_state, beat_plan, event, speech, thought, mark_committed, leaf_written, budget, banner; accept only control and request_replay_window.

Done when: Integration test with fake provider and a WS test client; viewer messages cannot mutate the world (R6).

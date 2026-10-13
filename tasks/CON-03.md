---
id: CON-03
title: Mock WS stream fixtures
wp: WP0
status: done
claimed_by: claude-main
claimed_at: 2026-10-13T23:33:41.173Z
branch: task/CON-03
depends_on: [CON-02]
owns: [fixtures/ws/**]
---
Spec: DESIGN.md §18 WebSocket protocol

Do: Hand-author (or script) a fixture of ~2 game days as JSONL of ServerMessages: hello, world_state, beat_plan, speech, event, mark_committed, leaf_written, one death and arrival. Add a validator test.

Done when: Every line passes ServerMessageSchema. Viewer tasks can run without the sim.

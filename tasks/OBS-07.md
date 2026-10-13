---
id: OBS-07
title: Analyst pass (optional LLM)
wp: WP9
status: open
claimed_by:
claimed_at:
branch:
depends_on: [OBS-05]
owns: [packages/observatory/src/analyst/**]
---
Spec: DESIGN.md §17 two layers and rules

Do: Separate model call with its own budget, outputs labeled interpretation with citations, stores model id and prompt versions. Never writes to a live run.

Done when: Fake-provider test; output always cites event ids.

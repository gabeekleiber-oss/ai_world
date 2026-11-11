---
id: OBS-01
title: Observatory scaffold and lexicon detectors
wp: WP9
status: claimed
claimed_by: claude-chat
claimed_at: 2026-11-11T14:20:52.710Z
branch: task/OBS-01
depends_on: [CON-02]
owns: [packages/observatory/package.json, packages/observatory/src/lexicon/**, tools/export-lexicon.mjs, packages/observatory/README.md]
---
Spec: DESIGN.md §9 taxonomy M0-M4, §17 new words/adoption

Do: New package, read-only over a run folder. New-token detection against a word list, adoption graph and half-life, M0-M4 per agent per day, export-lexicon.

Done when: Runs on a fixture run folder; cites event ids.

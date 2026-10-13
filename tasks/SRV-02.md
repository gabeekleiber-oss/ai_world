---
id: SRV-02
title: Run, resume and replay scripts
wp: WP1
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SRV-01, SIM-13]
owns: [package.json, scripts/**]
---
Spec: DESIGN.md README setup, §15

Do: `npm run run|resume|replay` with flags for seed, arm, mock vs live, headless. Update README status section.

Done when: Mock-mind headless 100-day run finishes; resume and replay work from a run folder.

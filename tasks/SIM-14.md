---
id: SIM-14
title: Calibration harness
wp: WP10
status: open
claimed_by:
claimed_at:
branch:
depends_on: [SIM-12, SIM-13]
owns: [tools/calibrate/**]
---
Spec: DESIGN.md §19 calibration table

Do: Script running every scenario in the §19 environment table and printing pass/fail with numbers.

Done when: All scenarios implemented; failures print the offending config keys. Do NOT tune toward cultural outcomes (R10).

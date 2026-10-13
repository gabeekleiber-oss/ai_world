---
id: PER-08
title: Crash-resume harness
wp: WP10
status: open
claimed_by:
claimed_at:
branch:
depends_on: [PER-02, SIM-11, SIM-13]
owns: [tests/resume/**]
---
Spec: DESIGN.md §19 kill -9 test

Do: Script that runs a mock sim, kill -9s it at random points over 50 trials, resumes, and compares state hash with an uninterrupted run; verifies no lost marks or leaf entries.

Done when: 50 trials pass.

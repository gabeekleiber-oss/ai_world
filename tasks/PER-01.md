---
id: PER-01
title: Persist scaffold, atomic writes, JSONL appender
wp: WP4
status: open
claimed_by:
claimed_at:
branch:
depends_on: []
owns: [packages/persist/package.json, packages/persist/src/fs/**, packages/persist/README.md]
---
Spec: DESIGN.md §15 write policy

Do: New package. tmp+fsync+rename helper, JSONL append with flush/fsync, run folder layout creator, schema_version stamping.

Done when: Tests simulate crash between tmp write and rename; layout matches §15.

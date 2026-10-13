---
id: PER-01
title: Persist scaffold, atomic writes, JSONL appender
wp: WP4
status: review
claimed_by: gpt-chat-next
claimed_at: 2026-10-14T00:00:00.000Z
branch: task/PER-01
depends_on: []
owns: [packages/persist/package.json, packages/persist/src/fs/**, packages/persist/test/**, packages/persist/README.md]
---
Spec: DESIGN.md §15 write policy

Do: New package. tmp+fsync+rename helper, JSONL append with flush/fsync, run folder layout creator, schema_version stamping.

Done when: Tests simulate crash between tmp write and rename; layout matches §15.

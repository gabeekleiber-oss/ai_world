---
id: CON-02
title: Event payload schemas
wp: WP0
status: open
claimed_by:
claimed_at:
branch:
depends_on: [CON-01]
owns: [packages/shared/src/payloads.ts, packages/shared/test/payloads.test.ts]
---
Spec: DESIGN.md §18 event taxonomy, §12 mark record

Do: One typed payload schema per EVENT_TYPE in events.ts, plus a discriminated union. Keep EventSchema envelope unchanged.

Done when: Every EVENT_TYPE has a payload schema; a test builds one valid event per type.

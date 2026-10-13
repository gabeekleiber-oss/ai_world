---
id: OBS-02
title: Ritual and liturgy detectors
wp: WP9
status: open
claimed_by:
claimed_at:
branch:
depends_on: [OBS-01]
owns: [packages/observatory/src/sequences/**]
---
Spec: DESIGN.md §17 ritual, liturgy, greetings

Do: Sequence mining keyed by place and light phase; repeated n-grams across days from the stone and elsewhere; first-utterance clustering.

Done when: Detectors output observation lines with evidence ids, no interpretation.

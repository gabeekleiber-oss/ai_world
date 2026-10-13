---
id: PCT-03
title: Phrase pools and in-world error lines
wp: WP2
status: open
claimed_by:
claimed_at:
branch:
depends_on: []
owns: [config/phrases/**, config/percept-lexicon.json, config/inhabitant-text.json]
---
Spec: DESIGN.md §7 dynamic wording, §8 validation step 5, §9 lint

Do: Write 3+ paraphrases per state change (hunger, eating, injury, fatigue, company, solitude, stillness, fear, light, weather) and per in-world failure line. Sensory nouns only from the whitelist.

Done when: `npm run lint:words` passes; every state has >=3 variants. No role or purpose words.

---
id: PCT-03
title: Phrase pools and in-world error lines
wp: WP2
status: done
claimed_by: gpt-chat-next
claimed_at: 2026-10-13T00:00:00.000Z
branch: task/PCT-03
depends_on: []
owns: [config/phrases/**, config/percept-lexicon.json, config/inhabitant-text.json]
---
Spec: DESIGN.md §7 dynamic wording, §8 validation step 5, §9 lint

Do: Write 3+ paraphrases per state change (hunger, eating, injury, fatigue, company, solitude, stillness, fear, light, weather) and per in-world failure line. Sensory nouns only from the whitelist.

Done when: `npm run lint:words` passes; every state has >=3 variants. No role or purpose words.

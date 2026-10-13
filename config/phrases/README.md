# Phrase pools

- `state-changes.json` groups the three-or-more sensory paraphrases for each dynamic state.
- `failures.json` groups alternatives for format and action failures.
- The same string pools are mirrored into `config/percept-lexicon.json` and `config/inhabitant-text.json`, respectively, because the existing `npm run lint:words` scans those two files. Keep the mirrors in sync when editing wording.

Use one variant per event, selected with the simulation's seeded random source. Keep wording observational and plain; do not explain what anything is for or name a role.

# Observatory

Offline, read-only analysis for recorded runs. The lexicon detector accepts typed events, classifies M0–M4 language evidence, and always retains event sequence numbers for citations.

Run `npx tsx tools/export-lexicon.mjs fixtures/ws/two-days.jsonl path/to/dictionary.txt` to emit the lexicon report. The optional dictionary is one or more words; tokens not in it are reported as coinages.

# Prompt builder (GW-03)

DESIGN.md section 9. `createPromptBuilder({ templates, config, lint, question, runSeed })`, with templates from `loadPromptTemplates(root)` (`config/prompts/system.txt`, `menu.txt`, `answer-form.txt`).

- Layers, in order: system prompt, memory block, percept, the closing question. `build(spec, { memory, percept })` returns `{ system, user, mindId }`; memory and percept are rendered text from the memory and percept code.
- The system prompt is the same for every mind except the order of the menu lines, which is seeded once per mind from `runSeed` and the mind's key, and the two leaf lines for the kit slot (`kit: "leaves"`). It is cached per mind, so the string never changes between calls and the provider can cache the prefix.
- Menu lines are `act: wording` in `menu.txt`, one per act in the shared schema. `<name>` placeholders (limits, headings, gestures, pigments) come from config and the shared schema, so the text cannot drift from what the validator accepts.
- Every static string is checked against the forbidden-word list when built (R2). A bad template, an unknown placeholder or a missing act fails at start-up.

Note for the owner: `compaction_prompt` in `config/inhabitant-text.json` still ends with "Keep the words you use for things.", which DESIGN.md C4 says to remove. It is outside this task's files.

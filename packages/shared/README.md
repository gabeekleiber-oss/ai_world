# @ai-world/shared

Contracts every other package imports (WP0). Browser-safe from the package root; file access lives in `@ai-world/shared/node`.

| Module | Contract |
|--------|----------|
| `config` | `ConfigSchema` (strict, unknown keys fail), `resolveConfig(raw, overrides)`, `applyArm` (arms A to D, DESIGN.md section 20) |
| `decision` | `buildDecisionSchema(cfg)`, `buildActionSchema(cfg)`, `capDecision` (control-character strip and hard length caps, every truncation reported), act name lists |
| `parse` | `extractJsonObject` tolerates code fences and trailing text |
| `handles` | `thing-N`, `other-N`, `place-N`; the eight egocentric headings |
| `marks` | `MarkRecordSchema`, `LeafEntrySchema`, `DrawingSchema`, `normalizeDrawing` (clamp, never reject) |
| `events` | `EVENT_TYPES`, `EventSchema`, `isNewer` for idempotent replay |
| `ws` | `ServerMessageSchema`; `ClientMessageSchema` accepts only `control` and `request_replay_window` |
| `percept` | `PERCEPT_SECTIONS` in truncation-priority order, `PerceptSchema`, `SnapshotSchema` envelope |
| `lint` | Forbidden-word lint: `compileLint`, `lintText`, `assertClean`, `findMetaLeaks`, `stripTemplateNoise` |
| `node` | `loadConfig(root, overrides)`, `loadLint(root)` |

Rules honored here: R2 (lint), R4 (LLM output is only a proposal, validated by schema), R9 (nothing is rewritten except hard caps, which are logged), and no viewer message can change the world (R6).

Tests: `npm test`. Word lint over all inhabitant-facing config: `npm run lint:words`.

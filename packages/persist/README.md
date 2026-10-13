# @ai-world/persist

Small filesystem primitives for durable run storage. This package does not own world state or choose when a simulation event is committed; callers await successful writes before applying state changes.

## API

- `writeFileAtomic(path, data)`: writes a sibling temporary file, fsyncs it, renames it over the destination, then attempts to fsync the containing directory. A failed rename leaves the previous destination intact; a hard crash before rename can leave an ignorable `.tmp` file.
- `appendJsonl(path, record, { schemaVersion? })`: appends one JSON object plus newline and fsyncs the file before resolving. Defaults `schema_version` to `1`.
- `stampSchemaVersion(record, version?)`: returns a copy with a positive integer `schema_version`.
- `createRunLayout(dataRoot, runId)`: creates `dataRoot/runs/<run-id>` and the world, events, cave, priests, minds, analysis, observatory, and logs directories from DESIGN.md §15.

All paths are local filesystem paths. No network, database, or process-global state is used.

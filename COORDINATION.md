# Coordination: parallel agents

Work is split into small tasks in `tasks/<ID>.md`. Each lists what it owns, what it depends on, the DESIGN.md sections to read, and a "done when". Tasks own disjoint files, so agents can work at the same time without merge conflicts.

## Loop

```text
node tools/tasks.mjs list                    # tasks that are open with all dependencies done
node tools/tasks.mjs show SIM-02             # read one
node tools/tasks.mjs claim SIM-02 claude-a   # atomic; exit 1 means someone else got it or it is not ready. Pick another.
git fetch origin && git checkout -b task/SIM-02 origin/main
# ...work, only inside the task's `owns` paths...
npm run check                                # typecheck, word lint, offline tests must pass
node tools/tasks.mjs finish SIM-02           # marks status: review in your working tree
git add -A && git commit -m "SIM-02: terrain and landmarks"
git fetch origin && git rebase origin/main && git push origin task/SIM-02
# open a PR titled "SIM-02: <title>" into main
```

The commands run on a fresh shallow clone of `origin/main`, so they never touch your working tree. Use a unique agent name (`claude-a`, `gpt-b`, ...).

Status flow: `open` -> `claimed` (direct push to main, first push wins) -> `review` (inside your PR) -> `done` (set by whoever merges: `node tools/tasks.mjs set SIM-02 done`). A task unlocks only when all its dependencies are `done`.

A claim older than 24 h shows as `STALE` and anyone may re-claim it. Giving a task up: `node tools/tasks.mjs release <ID>`. Stuck on something outside your task: `node tools/tasks.mjs set <ID> blocked` and say why in the PR or task file body.

## Rules for agents

1. Edit only paths in your task's `owns`, plus your own task file. Registering a new package in the root `tsconfig.json`/workspace config is allowed (one line; resolve rebase conflicts by keeping both lines).
2. `package-lock.json` conflicts on rebase: take main's version, then rerun `npm install`.
3. Shared contracts (`packages/shared`): never change the shape of an existing export. Small additive changes go in their own commit prefixed `contract:`. Anything bigger becomes a note to the owner.
4. Interfaces between packages: `Mind` and event emission are defined by SIM-11, `MarkSink`/`LeafSink` by SIM-10 (implemented by PER-03/PER-04), percept building by PCT-05, the decision pipeline by GW-04/GW-06. Code against `packages/shared` types and the DESIGN.md text until the dependency lands.
5. No network in tests. Use the fake provider and mock minds.
6. Every string an agent in the world could read passes the forbidden-word lint (`npm run lint:words`). Do not add wildlife, fire, or goal/role/purpose wording anywhere in-world.
7. Do not tune prompts, world features or numbers toward interesting cultural outcomes (R10). Calibration is for survival statistics only.
8. Tests live next to your package. If you cannot finish, `release` the task and leave notes in the PR.
9. Small PRs. One task per PR. Do not reformat files you do not own.

Read `DESIGN.md` sections 2 (rules R1-R11) and 18 first, then the sections named in your task.

## Waves (rough order; the script enforces real dependencies)

1. CON-01, SIM-01, PCT-01, PCT-03, GW-01, PER-01, VW-14 start immediately.
2. CON-02/03 unlock the viewer, persistence and observatory work; SIM-02 to SIM-06 run in parallel.
3. Action tasks (SIM-07 to SIM-10), percept and gateway pieces, viewer scene and UI tasks.
4. Integration: SIM-11, SIM-12, SRV-01, SRV-02, then Gate 1 (SRV-03).
5. Observatory, QA scripts, calibration.

Gates are in DESIGN.md section 18. Nothing talks to the live model until Gate 1 passes.

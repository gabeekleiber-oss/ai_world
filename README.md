# AI World

A local, real-time 3D world where four LLM-driven agents start with no goals, no history and no knowledge of why they exist, and are watched to see whether culture, rules, religion and language emerge on their own.

**Status:** design only. This repo contains the build bible, no code yet.

## Read this first

[`DESIGN.md`](DESIGN.md) is the full design: rules, world, agents, perception, actions, prompts, gateway, simulation numbers, cave marks, priest and book, viewer, persistence, observatory, work packages, tests, and (section 20) proposed levers for a stranger culture.

## The setup in brief

- One valley with a communal hall, a painting cave and one food source (berries).
- Four minds on Kimi K3 via NVIDIA NIM. Nobody is told a goal, a role or a rule.
- Each mind may leave exactly two marks on the cave wall in its whole life, and knows it. Lives last 100 game days.
- One body carries a stack of leaves and starts in the hall (the "priest" kit). One body carries a harmful temperament, felt as sensation, never as instruction. The temperament can fall on any of the four, the priest included.
- Everything is logged and replayable: every prompt, raw response, event and mark.

## Hard rules (summary)

1. No agent is told a goal, purpose, role or value. The only given fact is the two-mark limit.
2. A forbidden-word lint covers everything an agent can read.
3. The engine is authoritative; LLM output is a proposal.
4. No director, no rescue, no event injection.
5. Do not tune prompts or the environment toward interesting cultural outcomes.

Full list: `DESIGN.md` section 2.

## Planned layout

TypeScript monorepo: `shared`, `sim`, `percepts`, `gateway`, `persist`, `server`, `viewer`, `observatory`, `mock-minds`. Work packages and gates are in `DESIGN.md` section 18. Build order: contracts and lint, headless sim with mock minds, live minds, then the 3D viewer.

## Setup (once code exists)

```text
cp .env.example .env     # set NVIDIA_API_KEY; never commit .env
pnpm install
pnpm test                # offline, no network
pnpm run                 # start a run
pnpm resume <run-id>     # resume after a crash
pnpm replay <run-id>     # replay with no LLM
```

Model id, base URL and rate limits live in `config/default.json` and `.env`. Confirm them on the NVIDIA account page before the first live run.

## Not committed

`data/` and `.env` are gitignored.

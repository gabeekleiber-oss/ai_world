# @ai-world/sim

Simulation core. WP1a (this step) is the deterministic foundation; the beat loop, action resolution, combat and succession come in WP1b.

| Module | Contract |
|--------|----------|
| `rng` | `Rng(seed, label)`: named streams, so output depends only on seed and label. `getState`/`fromState` resume exactly. |
| `hash` | `canonical` (sorted-key JSON) and `stateHash` (sha256), the basis of the determinism and resume gates. |
| `clock` | `clockAt(beat)`: day, beat of day, dawn/day/dusk/night. |
| `terrain` | Seeded bowl-and-cliff height field from parameters only. `isWalkable` is the invisible wall. |
| `landmarks` | `generateLayout(cfg)`: hall, cave, pond, bush clusters, starting positions. Rules from DESIGN.md section 5, checked over 200 seeds in tests. Starts are out of sight of every bush and the hall, yet one bush is within 40 m. |
| `bodies` | `Body`, `spawnBody`, `vigor`, `ageDays`. `malicious` and `kind` are engine-only (R3, R11). |
| `needs` | `stepNeeds`: hunger, fatigue, forced sleep, healing, ageing, death cause. Starvation from full takes about 3.3 days. |
| `berries` | `stepBush`, `pickFrom`, carry limit, spoilage, `eatCarried`. Stripped bushes go dormant then regrow at half rate. |
| `temperament` | `drawMaliciousSlot`: seeded draw over all slots (D13). Always draws, so arms share a role map. |
| `world` | `createWorld(cfg)`, `stepPassive` (the no-decision part of a beat), `worldHash`. |

Everything is pure and offline. Same config and seed give the same world and the same hash.

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WorldStateSchema, type WorldState } from "@ai-world/shared";
import { loadConfig } from "@ai-world/shared/node";
import { createWorld, stepPassive, type World } from "../src";

const cfg = loadConfig(resolve(__dirname, "../../.."));

describe("shared state schemas match the engine", () => {
  it("a fresh world parses unchanged, so no field is missing from the contract", () => {
    const w = createWorld(cfg);
    expect(WorldStateSchema.parse(w)).toEqual(w);
    const asContract: WorldState = w; // compile-time check: engine World is assignable to the contract
    expect(asContract.schema_version).toBe(1);
  });
  it("still holds after 200 passive beats, including deaths", () => {
    let w: World = createWorld(cfg);
    for (let i = 0; i < 200; i++) w = stepPassive(w, cfg).world;
    expect(WorldStateSchema.parse(w)).toEqual(w);
  });
});

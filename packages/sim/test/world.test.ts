import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "@ai-world/shared/node";
import { createWorld, dist, drawMaliciousSlot, Rng, stateHash, worldHash } from "../src";

const root = resolve(__dirname, "../../..");
const cfgFor = (over: unknown) => loadConfig(root, over);

describe("createWorld", () => {
  it("is reproducible: same seed, same hash; different seed, different hash", () => {
    expect(worldHash(createWorld(cfgFor({ run: { seed: 5 } })))).toBe(worldHash(createWorld(cfgFor({ run: { seed: 5 } }))));
    expect(worldHash(createWorld(cfgFor({ run: { seed: 5 } })))).not.toBe(worldHash(createWorld(cfgFor({ run: { seed: 6 } }))));
  });
  it("places the kit body inside the hall and plain bodies at the starts, with staggered ages", () => {
    const cfg = cfgFor({}), w = createWorld(cfg);
    const kit = w.bodies.find((b) => b.kind === "priest-kit")!;
    expect(Math.abs(kit.pos.x - w.layout.hall.center.x)).toBeLessThan(w.layout.hall.size_m[0] / 2);
    expect(Math.abs(kit.pos.z - w.layout.hall.center.z)).toBeLessThan(w.layout.hall.size_m[1] / 2);
    w.bodies.filter((b) => b.kind === "plain").forEach((b, i) => expect(b.pos).toEqual(w.layout.starts[i]));
    expect(w.bodies.map((b) => b.start_age_days)).toEqual([15, 30, 45, 60]);
    expect(w.bodies.map((b) => b.id)).toEqual(["mind-1", "mind-2", "mind-3", "mind-4"]);
    expect(w.bodies.every((b) => b.satiety === 70 && b.carried.length === 0 && b.alive)).toBe(true);
  });
  it("exactly one body is malicious, and the kit slot can be it (D13)", () => {
    const hits = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const w = createWorld(cfgFor({ run: { seed } }));
      expect(w.bodies.filter((b) => b.malicious)).toHaveLength(1);
      hits.add(w.malicious_slot!);
    }
    expect([...hits].sort()).toEqual([0, 1, 2, 3]);
  });
  it("arms change sensation later, not the draw: arm B gets the same role map as arm A", () => {
    expect(createWorld(cfgFor({ run: { seed: 11, arm: "A" } })).malicious_slot).toBe(createWorld(cfgFor({ run: { seed: 11, arm: "B" } })).malicious_slot);
  });
});

describe("temperament draw", () => {
  const rng = (s: number) => new Rng(s, "t");
  it("plain_only never picks the kit slot; none picks nothing", () => {
    const plain = cfgFor({ population: { malicious_assignment: "plain_only" } });
    for (let s = 0; s < 80; s++) expect(drawMaliciousSlot(plain, rng(s))).not.toBe(3);
    expect(drawMaliciousSlot(cfgFor({ population: { malicious_assignment: "none" } }), rng(1))).toBeNull();
  });
});

describe("worlds do not leak role labels into agent-visible fields", () => {
  it("appearance carries no role or temperament information", () => {
    const w = createWorld(cfgFor({}));
    for (const b of w.bodies) expect(JSON.stringify(b.appearance)).not.toMatch(/priest|malicious|kit|plain/);
  });
  it("hash is stable under identical clones", () => {
    const w = createWorld(cfgFor({}));
    expect(stateHash(structuredClone(w))).toBe(stateHash(w));
    expect(dist(w.layout.hall.center, w.layout.cave.mouth)).toBeGreaterThan(0);
  });
});

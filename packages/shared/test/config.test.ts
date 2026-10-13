import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadConfig, readJson } from "../src/node";
import { resolveConfig } from "../src";

const root = resolve(__dirname, "../../..");

describe("config", () => {
  it("default.json validates and keeps the documented defaults", () => {
    const c = loadConfig(root);
    expect(c.time.beats_per_day).toBe(40);
    expect(c.needs.sleep_recovery).toBe(8);
    expect(c.marks.marks_per_life).toBe(2);
    expect(c.population.slots).toEqual(["plain", "plain", "plain", "priest-kit"]);
    expect(c.temperament.malicious_mode).toBe("T1");
  });
  it("arm B forces T0 and P0", () => {
    const c = loadConfig(root, { run: { arm: "B" } });
    expect([c.temperament.malicious_mode, c.temperament.priest_mode]).toEqual(["T0", "P0"]);
  });
  it("arm C adds syllabary speech; arm D adds the other levers", () => {
    expect(loadConfig(root, { run: { arm: "C" } }).alien.speech_channel).toBe("syllabary");
    const d = loadConfig(root, { run: { arm: "D" } });
    expect([d.alien.speech_channel, d.alien.gesture_set, d.alien.stone_placement, d.alien.sky_cycle]).toEqual(["syllabary", "neutral", "open_ground", "irregular"]);
  });
  it("rejects unknown keys (typos must not pass silently)", () => {
    expect(() => loadConfig(root, { needs: { satiety_decay_awak: 1 } })).toThrow(/Invalid config/);
  });
  it("rejects inconsistent values", () => {
    expect(() => loadConfig(root, { population: { staggered_start_ages: [15, 30] } })).toThrow(/one age per slot/);
    expect(() => loadConfig(root, { viewer: { zoom_min_m: 500 } })).toThrow(/zoom_max_m/);
  });
  it("does not mutate the raw input", () => {
    const raw = readJson(resolve(root, "config/default.json")) as { run: { arm: string } };
    resolveConfig(raw, { run: { arm: "B" } });
    expect(raw.run.arm).toBe("A");
  });
});

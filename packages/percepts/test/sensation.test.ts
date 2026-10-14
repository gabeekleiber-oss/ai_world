import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig, type Config } from "@ai-world/shared";
import { buildSensations, sensationText, type AddedSensationKind, type SensationKind, type SensationTrigger } from "../src/sensation";

const root = resolve(__dirname, "../../..");
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const raw = readJson("config/default.json");
const pools = readJson("config/phrases/state-changes.json").phrase_pools as Record<string, string[]>;
const lexiconPools = readJson("config/percept-lexicon.json").phrase_pools as Record<string, string[]>;

const cfg = (over: unknown = {}): Config => resolveConfig(raw, over);
type BodyArg = Parameters<typeof buildSensations>[1]["body"];
const body = (over: Partial<BodyArg> = {}): BodyArg => ({ kind: "plain", malicious: false, satiety: 90, fatigue: 10, health: 100, awake: true, alive: true, ...over });
const kinds = (c: Config, b: BodyArg, t: SensationTrigger[] = []) => buildSensations(c, { body: b, triggers: t }).map((l) => l.kind);

const ADDED: AddedSensationKind[] = ["malice_pleasure", "malice_irritation", "malice_satisfaction", "kit_warmth", "kit_wonder"];
const ALL_KINDS: SensationKind[] = ["hunger_growing", "hunger_empty", "eating", "injury", "fatigue", "relief", "company", "solitude", "stillness", "fear", ...ADDED];

describe("body sensations: one test per row of the section 6 table", () => {
  it("a well-fed, rested, unhurt body feels nothing in particular", () => {
    expect(kinds(cfg(), body())).toEqual([]);
  });
  it("satiety falling: a growing ache once below the starting level", () => {
    expect(kinds(cfg(), body({ satiety: 69 }))).toEqual(["hunger_growing"]);
    expect(kinds(cfg(), body({ satiety: 70 }))).toEqual([]);
  });
  it("satiety at 0: the sharp ache replaces the growing one", () => {
    expect(kinds(cfg(), body({ satiety: 0 }))).toEqual(["hunger_empty"]);
    expect(kinds(cfg(), body({ satiety: 0.5 }))).toEqual(["hunger_growing"]);
  });
  it("eating: sweetness and an easing ache", () => {
    expect(kinds(cfg(), body(), ["ate"])).toEqual(["eating"]);
  });
  it("injury: from being struck this beat, and for as long as health is below full", () => {
    expect(kinds(cfg(), body(), ["injured"])).toEqual(["injury"]);
    expect(kinds(cfg(), body({ health: 80 }))).toEqual(["injury"]);
    expect(kinds(cfg(), body({ health: 100 }))).toEqual([]);
  });
  it("fatigue high: heavy eyes from 75", () => {
    expect(kinds(cfg(), body({ fatigue: 74 }))).toEqual([]);
    expect(kinds(cfg(), body({ fatigue: 75 }))).toEqual(["fatigue"]);
    expect(kinds(cfg(), body({ fatigue: 100 }))).toEqual(["fatigue"]);
  });
  it("resting: relief", () => {
    expect(kinds(cfg(), body(), ["rested"])).toEqual(["relief"]);
  });
  it("others near and calm: faint ease", () => {
    expect(kinds(cfg(), body(), ["company"])).toEqual(["company"]);
  });
  it("alone for a long time: restlessness", () => {
    expect(kinds(cfg(), body(), ["solitude"])).toEqual(["solitude"]);
  });
  it("seeing a still one: cold heaviness", () => {
    expect(kinds(cfg(), body(), ["still_one"])).toEqual(["stillness"]);
  });
  it("being struck at: fear", () => {
    expect(kinds(cfg(), body(), ["threatened"])).toEqual(["fear"]);
  });
  it("everyone feels these, whatever the temperament or kit", () => {
    for (const b of [body(), body({ malicious: true }), body({ kind: "priest-kit" }), body({ kind: "priest-kit", malicious: true })]) {
      expect(kinds(cfg(), b, ["ate", "company", "threatened"])).toEqual(["eating", "company", "fear"]);
    }
  });
  it("a body that is gone feels nothing, even with every trigger", () => {
    const all: SensationTrigger[] = ["injured", "ate", "rested", "company", "solitude", "still_one", "threatened", "other_hurt", "listened", "darkness"];
    expect(kinds(cfg(), body({ alive: false, satiety: 0, fatigue: 100, health: 0 }), all)).toEqual([]);
  });
  it("several body sensations come in a fixed order: hunger, fatigue, injury, eating, relief, company, solitude, still, fear", () => {
    const b = body({ satiety: 0, fatigue: 90, health: 50 });
    expect(kinds(cfg(), b, ["threatened", "still_one", "solitude", "company", "rested", "ate"])).toEqual([
      "hunger_empty", "fatigue", "injury", "eating", "relief", "company", "solitude", "stillness", "fear",
    ]);
  });
  it("does not depend on the order triggers are given", () => {
    const t: SensationTrigger[] = ["ate", "company", "threatened"];
    expect(kinds(cfg(), body(), t)).toEqual(kinds(cfg(), body(), [...t].reverse()));
  });
});

describe("malicious temperament (T1)", () => {
  const mal = body({ malicious: true });
  it.each([["other_hurt"], ["other_afraid"], ["other_struggling"]] as const)("warm pleasure when another is %s", (t) => {
    expect(kinds(cfg(), mal, [t])).toEqual(["malice_pleasure"]);
  });
  it.each([["others_calm"], ["others_laughing"], ["food_shared"]] as const)("an itch of irritation when %s", (t) => {
    expect(kinds(cfg(), mal, [t])).toEqual(["malice_irritation"]);
  });
  it("lingering satisfaction when harm is not stopped", () => {
    expect(kinds(cfg(), mal, ["harm_unstopped"])).toEqual(["malice_satisfaction"]);
  });
  it("only the malicious body feels them", () => {
    for (const t of ["other_hurt", "others_calm", "harm_unstopped"] as const) expect(kinds(cfg(), body(), [t])).toEqual([]);
  });
  it("triggers that are not about others add nothing to the malicious body beyond what everyone feels", () => {
    expect(kinds(cfg(), mal, ["company", "ate"])).toEqual(["eating", "company"]);
  });
  it("tags the line as temperament, with the configured gain, and never carries a label", () => {
    const [line] = buildSensations(cfg({ temperament: { sensation_gain: 1.5 } }), { body: mal, triggers: ["other_hurt"] });
    expect(line).toEqual({ kind: "malice_pleasure", source: "temperament", gain: 1.5 });
    expect(JSON.stringify(line)).not.toMatch(/malicious|priest|kit-slot/i);
  });
  it("T0 removes them", () => {
    expect(kinds(cfg({ temperament: { malicious_mode: "T0" } }), mal, ["other_hurt", "others_calm", "harm_unstopped"])).toEqual([]);
  });
});

describe("priest kit (P1)", () => {
  const kit = body({ kind: "priest-kit" });
  it.each([["listened"], ["quiet_gathering"]] as const)("warmth when %s", (t) => {
    expect(kinds(cfg(), kit, [t])).toEqual(["kit_warmth"]);
  });
  it.each([["darkness"], ["moon_changed"], ["still_one"], ["food_relief"]] as const)("a pull of wonder at %s", (t) => {
    const out = kinds(cfg(), kit, [t]);
    expect(out).toContain("kit_wonder");
  });
  it("a still one gives the kit body both the cold feeling everyone has and the wonder", () => {
    expect(kinds(cfg(), kit, ["still_one"])).toEqual(["stillness", "kit_wonder"]);
  });
  it("a plain body feels none of it", () => {
    expect(kinds(cfg(), body(), ["listened", "quiet_gathering", "darkness", "moon_changed", "food_relief"])).toEqual([]);
  });
  it("tags the line as kit with the configured gain", () => {
    const [line] = buildSensations(cfg({ temperament: { sensation_gain: 0.5 } }), { body: kit, triggers: ["listened"] });
    expect(line).toEqual({ kind: "kit_warmth", source: "kit", gain: 0.5 });
  });
  it("P0 removes them", () => {
    expect(kinds(cfg({ temperament: { priest_mode: "P0" } }), kit, ["listened", "darkness"])).toEqual([]);
  });
});

describe("both on one body: the sensations simply stack", () => {
  const both = body({ kind: "priest-kit", malicious: true });
  it("gives temperament and kit lines together, in a fixed order after the body lines", () => {
    expect(kinds(cfg(), both, ["still_one", "other_hurt", "listened"])).toEqual(["stillness", "malice_pleasure", "kit_warmth", "kit_wonder"]);
  });
  it("is exactly the union of what each would feel alone", () => {
    const t: SensationTrigger[] = ["other_hurt", "others_calm", "harm_unstopped", "listened", "darkness"];
    const alone = [...kinds(cfg(), body({ malicious: true }), t), ...kinds(cfg(), body({ kind: "priest-kit" }), t)];
    expect(kinds(cfg(), both, t)).toEqual(alone);
  });
  it("both lines appear for the same trigger set, with no special line for the combination", () => {
    const out = kinds(cfg(), both, ["other_hurt", "listened"]);
    expect(out).toEqual(["malice_pleasure", "kit_warmth"]);
    expect(out.some((k) => /both|combo/.test(k))).toBe(false);
  });
});

describe("arm B emits nothing extra", () => {
  const every: SensationTrigger[] = ["other_hurt", "other_afraid", "other_struggling", "others_calm", "others_laughing", "food_shared", "harm_unstopped", "listened", "quiet_gathering", "darkness", "moon_changed", "food_relief"];
  const both = body({ kind: "priest-kit", malicious: true });
  it("a resolved arm B config (T0 and P0) adds no temperament or kit line", () => {
    expect(kinds(cfg({ run: { arm: "B" } }), both, every)).toEqual([]);
  });
  it("an un-resolved arm B config (modes still T1 and P1) still adds none", () => {
    const unresolved: Config = { ...structuredClone(cfg()), run: { ...cfg().run, arm: "B" } };
    expect(unresolved.temperament.malicious_mode).toBe("T1");
    expect(kinds(unresolved, both, every)).toEqual([]);
  });
  it("arm B keeps the ordinary body sensations", () => {
    expect(kinds(cfg({ run: { arm: "B" } }), body({ satiety: 20 }), ["ate", "threatened"])).toEqual(["hunger_growing", "eating", "fear"]);
  });
  it("arm A, C and D do add them", () => {
    for (const arm of ["A", "C", "D"]) expect(kinds(cfg({ run: { arm } }), both, ["other_hurt", "listened"])).toEqual(["malice_pleasure", "kit_warmth"]);
  });
  it("a gain of zero silences the added lines and leaves body lines alone", () => {
    expect(kinds(cfg({ temperament: { sensation_gain: 0 } }), both, ["other_hurt", "listened", "ate"])).toEqual(["eating"]);
  });
});

describe("wording comes only from the PCT-03 pools", () => {
  it("every sensation kind has a pool of at least three paraphrases", () => {
    for (const k of ALL_KINDS) expect(pools[k]?.length, k).toBeGreaterThanOrEqual(3);
  });
  it("the lint-checked lexicon mirrors the pools exactly", () => {
    expect(lexiconPools).toEqual(pools);
  });
  it("the resolver picks a variant by roll and returns only pool text", () => {
    for (const k of ALL_KINDS) {
      const pool = pools[k]!;
      const seen = new Set(pool.map((_, i) => sensationText({ kind: k }, pools, (i + 0.5) / pool.length)));
      expect(seen.size).toBe(pool.length);
      for (const text of seen) expect(pool).toContain(text);
    }
  });
  it("a roll just under 1 picks the last variant and 0 the first", () => {
    const p = pools.eating!;
    expect(sensationText({ kind: "eating" }, pools, 0)).toBe(p[0]);
    expect(sensationText({ kind: "eating" }, pools, 0.999999)).toBe(p[p.length - 1]);
  });
  it("refuses a missing pool or a bad roll instead of producing a blank line", () => {
    expect(() => sensationText({ kind: "eating" }, {}, 0.5)).toThrow(/no phrase pool/);
    expect(() => sensationText({ kind: "eating" }, { eating: [] }, 0.5)).toThrow(/no phrase pool/);
    expect(() => sensationText({ kind: "eating" }, pools, 1)).toThrow(RangeError);
    expect(() => sensationText({ kind: "eating" }, pools, -0.1)).toThrow(RangeError);
  });
  it("descriptors carry no wording and no engine labels", () => {
    const lines = buildSensations(cfg(), { body: body({ kind: "priest-kit", malicious: true, satiety: 0, fatigue: 99, health: 10 }), triggers: ["ate", "other_hurt", "listened", "darkness", "threatened"] });
    expect(lines.length).toBeGreaterThan(4);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(["gain", "kind", "source"]);
  });
  it("no phrase names a role, an instruction or a purpose", () => {
    const text = Object.values(pools).flat().join(" ").toLowerCase();
    for (const bad of ["worship", "priest", "hurt them", "you should", "you must", "kill", "pray", "god", "holy", "evil"]) expect(text).not.toContain(bad);
  });
});

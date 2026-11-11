import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { ACT_NAMES, KIT_ONLY_ACTS, buildDecisionSchema, resolveConfig, type ActName } from "@ai-world/shared";
import { loadLint, readJson } from "@ai-world/shared/node";
import { createPromptBuilder, loadPromptTemplates, parseMenu, seededShuffle, type PromptTemplates } from "../src/prompt";

const root = join(__dirname, "..", "..", "..");
const config = resolveConfig(readJson(join(root, "config", "default.json")));
const lint = loadLint(root);
const templates = loadPromptTemplates(root);
const QUESTION = (readJson(join(root, "config", "inhabitant-text.json")) as { question: string }).question;

const make = (over: Partial<{ templates: PromptTemplates; runSeed: string | number; config: typeof config }> = {}) =>
  createPromptBuilder({ templates, config, lint, question: QUESTION, runSeed: 1234, ...over });

const MINDS = ["mind-a", "mind-b", "mind-c", "mind-d"];
const MENU_START = "Your body can do these things:\n";
const MENU_END = "\n\nSpeak your answer";
const split = (system: string) => {
  const a = system.indexOf(MENU_START) + MENU_START.length;
  const b = system.indexOf(MENU_END);
  return { before: system.slice(0, a), menu: system.slice(a, b).split("\n"), after: system.slice(b) };
};

describe("prompt templates", () => {
  it("give every act in the schema exactly one menu line", () => {
    expect([...parseMenu(templates.menu).keys()].sort()).toEqual([...ACT_NAMES].sort());
  });

  it("mention every field of every act, with the same names the schema uses", () => {
    const samples: Record<ActName, Record<string, unknown>> = {
      move: { to: "place-1", heading: "ahead", steps: 3, gait: "run" }, turn: { to: "other-1", heading: "left" }, wait: { beats: 2 }, rest: {},
      pick: { from: "thing-1" }, eat: { from: "thing-1" }, drop: { item: "x", count: 1 }, give: { to: "other-1", count: 1 }, take: { from: "other-1" },
      hit: { target: "other-1", force: "light" }, push: { target: "other-1" }, drag: { target: "thing-1", release: true },
      gesture: { kind: "wave", target: "other-1" }, look: { at: "thing-1" }, label: { handle: "thing-1", text: "x" }, study_mark: { handle: "thing-1" },
      mark_prepare: { mode: "text", content: "x" }, mark_commit: {}, mark_abandon: {}, leaf_write: { text: "x" }, leaf_read: { last_n: 2, search: "x" },
    };
    const schema = buildDecisionSchema(config);
    const lines = parseMenu(templates.menu);
    for (const act of ACT_NAMES) {
      const action = { act, ...samples[act] };
      expect(schema.safeParse({ thought: "", say: null, do: action }).success, `${act} sample is valid`).toBe(true);
      for (const key of Object.keys(samples[act])) expect(lines.get(act), `${act}.${key}`).toContain(`"${key}"`);
    }
  });

  it("use the phrase for the hollow place only in the frame and the marks line", () => {
    const withPhrase = [...parseMenu(templates.menu)].filter(([, t]) => /hollow place/i.test(t)).map(([a]) => a);
    expect(withPhrase).toEqual(["mark_prepare"]);
  });
});

describe("system prompt", () => {
  it("passes the forbidden-word lint for every kit, and every placeholder is filled", () => {
    const b = make();
    for (const kit of ["regular", "leaves"] as const) {
      const s = b.system({ mindId: "m", kit });
      expect(s).not.toMatch(/<[a-z_ ,]+>/);
      expect(s).not.toMatch(/^#/m);
    }
  });

  it("is identical across minds except for menu order, and the kit slot's two extra lines", () => {
    const b = make();
    const regular = MINDS.map((mindId) => split(b.system({ mindId, kit: "regular" })));
    for (const r of regular) {
      expect(r.before).toBe(regular[0]!.before);
      expect(r.after).toBe(regular[0]!.after);
      expect([...r.menu].sort()).toEqual([...regular[0]!.menu].sort());
    }
    const kit = split(b.system({ mindId: "mind-k", kit: "leaves" }));
    expect(kit.before).toBe(regular[0]!.before);
    expect(kit.after).toBe(regular[0]!.after);
    const extra = kit.menu.filter((l) => !regular[0]!.menu.includes(l));
    expect(extra.map((l) => l.split(":")[0])).toEqual(expect.arrayContaining(["- leaf_write", "- leaf_read"]));
    expect(extra).toHaveLength(KIT_ONLY_ACTS.length);
    expect(regular[0]!.menu.some((l) => l.startsWith("- leaf_"))).toBe(false);
  });

  it("shuffles once per mind: stable for the same seed, different between minds and between runs", () => {
    const a = make();
    const orders = MINDS.map((mindId) => a.menuOrder({ mindId, kit: "regular" }).join());
    expect(new Set(orders).size).toBeGreaterThan(1);
    expect(MINDS.map((mindId) => make().menuOrder({ mindId, kit: "regular" }).join())).toEqual(orders);
    expect(make({ runSeed: 99 }).menuOrder({ mindId: "mind-a", kit: "regular" }).join()).not.toBe(orders[0]);
    expect(a.system({ mindId: "mind-a", kit: "regular" })).toBe(a.system({ mindId: "mind-a", kit: "regular" }));
    expect(a.menuOrder({ mindId: "x", kit: "regular", menuKey: "shared" })).toEqual(a.menuOrder({ mindId: "y", kit: "regular", menuKey: "shared" }));
  });

  it("is a stable prefix: layers after it never change it", () => {
    const b = make();
    const spec = { mindId: "mind-a", kit: "regular" } as const;
    const one = b.build(spec, { memory: "an account", percept: "light now" });
    const two = b.build(spec, { memory: "another account", percept: "dark now" });
    expect(one.system).toBe(two.system);
    expect(one.system).toBe(b.system(spec));
  });

  it("takes limits from config, not from the template text", () => {
    const tweaked = resolveConfig({ ...(readJson(join(root, "config", "default.json")) as object), movement: { ...config.movement, move_max_steps: 17 } });
    expect(make({ config: tweaked }).system({ mindId: "m", kit: "regular" })).toContain("1 to 17");
    expect(make().system({ mindId: "m", kit: "regular" })).toContain(`1 to ${config.movement.move_max_steps}`);
  });

  it("states the one given fact and the answer form", () => {
    const s = make().system({ mindId: "m", kit: "regular" });
    expect(s).toContain("you may make only two marks");
    expect(s).toContain('{"thought"');
    expect(s).toContain(`at most ${config.actions.thought_max_words} words`);
  });
});

describe("layers", () => {
  it("orders memory, percept, then the question, and skips an empty memory", () => {
    const b = make();
    const spec = { mindId: "m", kit: "regular" } as const;
    expect(b.build(spec, { memory: "MEM", percept: "PER" }).user).toBe(`MEM\n\nPER\n\n${QUESTION}`);
    expect(b.build(spec, { memory: "  ", percept: "PER" }).user).toBe(`PER\n\n${QUESTION}`);
    expect(b.build(spec, { memory: "MEM", percept: "PER" }).mindId).toBe("m");
  });
});

describe("fails at start-up, not in a live call", () => {
  it("rejects a template with a forbidden word", () => {
    const bad = { ...templates, menu: templates.menu.replace("lie down and sleep", "lie down in a cave and sleep") };
    expect(() => make({ templates: bad }).system({ mindId: "m", kit: "regular" })).toThrow(/Forbidden word/);
  });

  it("rejects an unknown placeholder, a missing act and a missing frame slot", () => {
    expect(() => make({ templates: { ...templates, menu: templates.menu.replace("<headings>", "<headingz>") } }).system({ mindId: "m", kit: "regular" })).toThrow(/unknown placeholder/);
    expect(() => make({ templates: { ...templates, menu: templates.menu.replace(/^leaf_read:.*$/m, "") } })).toThrow(/missing/);
    expect(() => make({ templates: { ...templates, system: templates.system.replace("<schema with field names>", "") } })).toThrow(/placeholder/);
  });

  it("rejects a closing question with a forbidden word", () => {
    expect(() => make({ })).not.toThrow();
    expect(() => createPromptBuilder({ templates, config, lint, question: "What does the player do next?", runSeed: 1 })).toThrow(/Forbidden word/);
  });
});

describe("seededShuffle", () => {
  it("is a permutation and repeatable", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = seededShuffle(items, "k");
    expect([...out].sort()).toEqual(items);
    expect(seededShuffle(items, "k")).toEqual(out);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

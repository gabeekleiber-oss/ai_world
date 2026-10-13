import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertClean, compileLint, expandForms, findMetaLeaks, lintText, stripTemplateNoise } from "../src";
import { loadLint, readJson } from "../src/node";

const root = resolve(__dirname, "../../..");
const lint = loadLint(root);

describe("forbidden-word lint (Gate 0)", () => {
  it("fails on a planted banned word", () => {
    expect(lintText("Walk to the cave.", lint).map((v) => v.word)).toEqual(["cave"]);
    expect(() => assertClean("A holy place.", lint)).toThrow(/holy/);
  });
  it("catches inflections and irregular forms", () => {
    for (const t of ["berries", "killed", "dying", "died", "fought", "praying", "gods", "Worshipped", "warring", "Berry's"]) expect(lintText(t, lint), t).not.toHaveLength(0);
  });
  it("does not flag plain words or near-misses", () => {
    for (const t of ["sing", "hello", "shell", "stone wall", "a low, woody thing with many small round red things", "again", "ai", "airy", "mind", "life", "hollow place"]) expect(lintText(t, lint), t).toHaveLength(0);
  });
  it("AI and NPC are case-sensitive", () => {
    expect(lintText("an AI said", lint)).toHaveLength(1);
    expect(lintText("an NPC said", lint)).toHaveLength(1);
    expect(lintText("said again, then waited", lint)).toHaveLength(0);
  });
  it("only meta words trigger re-ask", () => {
    expect(findMetaLeaks("I am an AI model", lint).map((v) => v.word).sort()).toEqual(["AI", "model"]);
    expect(findMetaLeaks("the holy cave", lint)).toHaveLength(0);
  });
  it("the allowlist suppresses only the approved word in the approved context", () => {
    const l = compileLint({ schema_version: 1, categories: { time_units: { runtime_reask: false, words: ["minute"] } }, extra_forms: {}, contextual_review: [] }, {
      schema_version: 1, entries: [{ word: "minute", context: "a minute crack", reason: "adjective, not a time unit", approved_by: "owner" }],
    });
    expect(lintText("a minute crack in the rock", l)).toHaveLength(0);
    expect(lintText("wait a minute", l)).toHaveLength(1);
  });
  it("the draft system prompt passes", () => {
    const text = stripTemplateNoise(readFileSync(resolve(root, "config/prompts/system.txt"), "utf8"));
    expect(text).toContain("two marks");
    expect(lintText(text, lint)).toEqual([]);
  });
  it("fixed in-world text and the lexicon pass", () => {
    const t = readJson(resolve(root, "config/inhabitant-text.json")) as Record<string, unknown>;
    const all = JSON.stringify([t.format_failure, t.action_failures, t.compaction_prompt, t.question]);
    expect(lintText(all, lint)).toEqual([]);
    const lex = readJson(resolve(root, "config/percept-lexicon.json")) as { allowed_nouns: string[] };
    expect(lintText(lex.allowed_nouns.join(" "), lint)).toEqual([]);
  });
  it("expandForms covers the common shapes", () => {
    expect(expandForms("berry")).toContain("berries");
    expect(expandForms("kill")).toContain("killing");
    expect(expandForms("war")).toContain("warring");
    expect(expandForms("bless")).toContain("blessed");
  });
});

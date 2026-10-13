/**
 * Build-time forbidden-word lint (Gate 0). Scans every inhabitant-facing source we currently have:
 * prompt templates, fixed in-world text, the percept lexicon. Exits 1 on any violation.
 * Usage: npm run lint:words [extra-file ...]
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintText, stripTemplateNoise } from "../packages/shared/src/lint";
import { loadLint, readJson } from "../packages/shared/src/node";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lint = loadLint(root);
let failures = 0;
let scanned = 0;

function check(label: string, text: string): void {
  scanned++;
  for (const v of lintText(text, lint)) {
    failures++;
    console.error(`FORBIDDEN  ${label}: "${v.matched}" [${v.category}]`);
  }
}

function strings(node: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((n, i) => strings(n, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) if (k !== "note") strings(v, `${path}.${k}`, out);
  return out;
}

// 1. Prompt templates
const promptDir = join(root, "config", "prompts");
for (const f of readdirSync(promptDir).filter((n) => n.endsWith(".txt"))) check(`config/prompts/${f}`, stripTemplateNoise(readFileSync(join(promptDir, f), "utf8")));

// 2. Fixed in-world text
for (const [p, s] of strings(readJson(join(root, "config", "inhabitant-text.json")), "inhabitant-text")) check(p, s);

// 3. Percept lexicon (allowed nouns and phrase pools)
for (const [p, s] of strings(readJson(join(root, "config", "percept-lexicon.json")), "percept-lexicon")) check(p, s);

// 4. Any extra text files named on the command line
for (const f of process.argv.slice(2)) check(f, readFileSync(f, "utf8"));

if (failures) { console.error(`\n${failures} forbidden word(s) in ${scanned} string(s). Use plainer wording; exceptions need owner approval in config/forbidden-allowlist.json.`); process.exit(1); }
console.log(`Word lint clean: ${scanned} inhabitant-facing string(s) checked.`);

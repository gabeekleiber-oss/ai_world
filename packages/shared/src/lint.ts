import { z } from "zod";

/**
 * Forbidden-word lint for inhabitant-facing text (DESIGN.md section 9, rule R2).
 * It scans what the engine says to agents. It never scans what agents say.
 */
export const ForbiddenListSchema = z.object({
  schema_version: z.literal(1),
  note: z.string().optional(),
  categories: z.record(z.object({ runtime_reask: z.boolean(), words: z.array(z.string()), case_sensitive_words: z.array(z.string()).optional() })),
  extra_forms: z.record(z.array(z.string())).default({}),
  contextual_review: z.array(z.string()).default([]),
});
export type ForbiddenList = z.infer<typeof ForbiddenListSchema>;

export const AllowlistSchema = z.object({
  schema_version: z.literal(1),
  note: z.string().optional(),
  entries: z.array(z.object({ word: z.string(), context: z.string().optional(), reason: z.string().min(1), approved_by: z.string().min(1) })).default([]),
});
export type Allowlist = z.infer<typeof AllowlistSchema>;

export interface Violation { word: string; matched: string; category: string; index: number; runtimeReask: boolean }

const VOWELS = /[aeiou]/;
/** Simple inflections. Over-matching is fine for a lint: a false positive is fixed with plainer wording or an approved allowlist entry. */
export function expandForms(word: string, extra: string[] = []): string[] {
  const w = word.toLowerCase();
  const forms = new Set<string>([w, ...extra.map((e) => e.toLowerCase())]);
  const suffixes = ["s", "es", "ed", "d", "ing", "er", "ers", "ly"];
  for (const s of suffixes) forms.add(w + s);
  if (w.endsWith("e")) { const stem = w.slice(0, -1); for (const s of ["ing", "ed", "er", "ers"]) forms.add(stem + s); }
  if (w.endsWith("y") && w.length > 2) { const stem = w.slice(0, -1); for (const s of ["ies", "ied", "ier"]) forms.add(stem + s); }
  const m = /[^aeiou][aeiou]([^aeiouwxy])$/.exec(w);
  if (m && VOWELS.test(w)) { const dbl = w + m[1]; for (const s of ["ing", "ed", "er", "ers"]) forms.add(dbl + s); }
  return [...forms];
}

export interface CompiledLint { insensitive: Map<string, { word: string; category: string; runtimeReask: boolean }>; sensitive: Map<string, { word: string; category: string; runtimeReask: boolean }>; allow: Allowlist["entries"] }

export function compileLint(list: ForbiddenList, allow: Allowlist = { schema_version: 1, entries: [] }): CompiledLint {
  const insensitive: CompiledLint["insensitive"] = new Map();
  const sensitive: CompiledLint["sensitive"] = new Map();
  for (const [category, c] of Object.entries(list.categories)) {
    for (const word of c.words) for (const f of expandForms(word, list.extra_forms[word.toLowerCase()] ?? [])) if (!insensitive.has(f)) insensitive.set(f, { word, category, runtimeReask: c.runtime_reask });
    for (const word of c.case_sensitive_words ?? []) sensitive.set(word, { word, category, runtimeReask: c.runtime_reask });
  }
  return { insensitive, sensitive, allow: allow.entries };
}

const TOKEN = /[A-Za-z][A-Za-z'\u2019]*/g;

export function lintText(text: string, lint: CompiledLint): Violation[] {
  const out: Violation[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0].replace(/['\u2019]s$/i, "");
    const hit = lint.sensitive.get(tok) ?? lint.insensitive.get(tok.toLowerCase());
    if (!hit) continue;
    const allowed = lint.allow.some((a) => a.word.toLowerCase() === hit.word.toLowerCase() && (!a.context || text.includes(a.context)));
    if (allowed) continue;
    out.push({ word: hit.word, matched: m[0], category: hit.category, index: m.index ?? 0, runtimeReask: hit.runtimeReask });
  }
  return out;
}

/** Throws if any inhabitant-facing string breaks the list. Used as the runtime assertion (R2). */
export function assertClean(text: string, lint: CompiledLint, label = "inhabitant text"): void {
  const v = lintText(text, lint);
  if (v.length) throw new Error(`Forbidden word in ${label}: ${v.map((x) => `"${x.matched}" (${x.category})`).join(", ")}`);
}

/** Meta-leak check for agent output (section 9): only categories flagged runtime_reask. Thought is exempt, flagged elsewhere. */
export function findMetaLeaks(text: string, lint: CompiledLint): Violation[] {
  return lintText(text, lint).filter((v) => v.runtimeReask);
}

/** Strip comment lines and <placeholders> from a prompt template before linting. */
export function stripTemplateNoise(text: string): string {
  return text.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n").replace(/<[^<>\n]*>/g, " ");
}

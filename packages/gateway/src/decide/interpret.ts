import {
  capDecision, extractJsonObject, findMetaLeaks, stripControl,
  type buildDecisionSchema, type CompiledLint, type Config, type Decision, type Truncation,
} from "@ai-world/shared";
import type { RawMetaLeak } from "./types";

export type DecisionSchema = ReturnType<typeof buildDecisionSchema>;

export interface InterpretContext {
  schema: DecisionSchema;
  lint: CompiledLint;
  caps: Pick<Config, "actions" | "marks" | "priest">;
}

export type Interpretation =
  | {
      ok: true;
      /** Parsed and capped. Only control characters and over-length text are touched (R9). */
      decision: Decision;
      truncations: Truncation[];
      /** Meta-category words in `say` or in the text of the chosen act. These count as a failed answer. */
      leaks: RawMetaLeak[];
      /** Meta-category words in `thought`. Exempt from failure, flagged for the owner. */
      thoughtLeaks: RawMetaLeak[];
    }
  | { ok: false; reason: "unparseable" | "schema"; detail: string };

interface AgentText { field: RawMetaLeak["field"]; path: string; text: string }

/**
 * The free text an agent wrote for the world to see or keep: speech, a label, a mark, a leaf entry or a leaf search.
 * Handles and enums are patterns checked by the schema, and item names are resolved against the percept by the engine,
 * so they carry no free text of their own.
 */
function agentTexts(d: Decision): AgentText[] {
  const out: AgentText[] = [];
  if (d.say) out.push({ field: "say", path: "say.text", text: d.say.text });
  const a = d.do;
  if (a.act === "label") out.push({ field: "label", path: "do.text", text: a.text });
  else if (a.act === "mark_prepare" && typeof a.content === "string") out.push({ field: "mark", path: "do.content", text: a.content });
  else if (a.act === "leaf_write") out.push({ field: "leaf", path: "do.text", text: a.text });
  else if (a.act === "leaf_read" && a.search !== undefined) out.push({ field: "leaf", path: "do.search", text: a.search });
  return out;
}

function scan(texts: AgentText[], lint: CompiledLint): RawMetaLeak[] {
  const found: RawMetaLeak[] = [];
  for (const t of texts) {
    // Control characters are stripped first so they cannot be used to split a word and slip past the list.
    for (const v of findMetaLeaks(stripControl(t.text), lint)) {
      found.push({ field: t.field, path: t.path, word: v.word, matched: v.matched, category: v.category });
    }
  }
  return found;
}

const DETAIL_MAX = 300;
const clip = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s);

/**
 * Steps 1, 2 and 7 of the validation pipeline (DESIGN.md section 8), plus the meta-leak scan (section 9).
 * Handle resolution and feasibility (steps 3 to 5) belong to the engine, not the gateway.
 *
 * Leaks are scanned on the text as the agent wrote it, before the length caps, so a word cannot hide past the cut.
 * Nothing here repairs, rewrites or drops anything the agent said. A bad answer is reported as bad.
 */
export function interpretResponse(raw: string, ctx: InterpretContext, options: { outputCut?: boolean } = {}): Interpretation {
  const json = extractJsonObject(raw);
  if (json === undefined) {
    const why = raw.trim() === "" ? "empty response" : options.outputCut ? "no complete JSON object; the output ran out of room" : "no JSON object found";
    return { ok: false, reason: "unparseable", detail: why };
  }

  const parsed = ctx.schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, reason: "schema", detail: clip(issues.join("; ")) };
  }

  const leaks = scan(agentTexts(parsed.data), ctx.lint);
  const thoughtLeaks = scan([{ field: "thought", path: "thought", text: parsed.data.thought }], ctx.lint);
  const { decision, truncations } = capDecision(parsed.data, ctx.caps);
  return { ok: true, decision, truncations, leaks, thoughtLeaks };
}

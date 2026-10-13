/**
 * Pull the first top-level JSON object out of model output, tolerating code fences and trailing text
 * (DESIGN.md section 8, step 1). Returns undefined if no parseable object is found. String-aware brace matching.
 */
export function extractJsonObject(raw: string): unknown | undefined {
  const text = raw.replace(/```(?:json)?/gi, " ");
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return undefined;
}

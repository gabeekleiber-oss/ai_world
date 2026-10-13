import { createHash } from "node:crypto";

/** JSON with sorted keys, so equal states always serialize identically (used for the determinism gates). */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function stateHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

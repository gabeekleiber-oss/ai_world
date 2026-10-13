import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig, type Config } from "./config";
import { AllowlistSchema, ForbiddenListSchema, compileLint, type CompiledLint } from "./lint";

/** Node-only helpers (file access). Browser code imports from the package root, not from here. */
export function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }

export function loadConfig(root: string, overrides?: unknown): Config {
  return resolveConfig(readJson(join(root, "config", "default.json")), overrides);
}

export function loadLint(root: string): CompiledLint {
  const list = ForbiddenListSchema.parse(readJson(join(root, "config", "forbidden-words.json")));
  const allow = AllowlistSchema.parse(readJson(join(root, "config", "forbidden-allowlist.json")));
  return compileLint(list, allow);
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptTemplates } from "./builder";

/** Read the prompt templates from `config/prompts` under the repo root. */
export function loadPromptTemplates(root: string): PromptTemplates {
  const read = (name: string): string => readFileSync(join(root, "config", "prompts", name), "utf8");
  return { system: read("system.txt"), menu: read("menu.txt"), answerForm: read("answer-form.txt") };
}

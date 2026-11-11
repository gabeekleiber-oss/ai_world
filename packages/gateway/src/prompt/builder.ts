import { assertClean, type CompiledLint, type ActName } from "@ai-world/shared";
import { actsFor, menuOrder, parseMenu, placeholderValues, renderMenu, type PromptConfig } from "./menu";
import { fillPlaceholders, stripComments } from "./template";

export interface PromptTemplates {
  /** config/prompts/system.txt */
  system: string;
  /** config/prompts/menu.txt */
  menu: string;
  /** config/prompts/answer-form.txt */
  answerForm: string;
}

export type Kit = "regular" | "leaves";

export interface MindSpec {
  mindId: string;
  /** `leaves` for the kit slot (adds the two leaf lines to the menu), `regular` otherwise. */
  kit: Kit;
  /** Seeds the menu order. Defaults to `mindId`. Keep it the same for the mind's whole life. */
  menuKey?: string;
}

export interface PromptBuilderOptions {
  templates: PromptTemplates;
  config: PromptConfig;
  lint: CompiledLint;
  /** The closing question, from `question` in config/inhabitant-text.json. */
  question: string;
  /** Run seed from config. Same seed and mind give the same menu order. */
  runSeed: string | number;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  mindId: string;
}

export interface PromptLayers {
  /** The mind's own account and recent lines, already rendered (section 10). Empty for a first call. */
  memory: string;
  /** The percept for this beat, already rendered by the percepts package. */
  percept: string;
}

const MENU_TOKEN = "<action menu, shuffled per mind>";
const FORM_TOKEN = "<schema with field names>";

export interface PromptBuilder {
  /** The fixed system layer for a mind. The same string every call, so the provider can cache the prefix. */
  system(spec: MindSpec): string;
  /** The order the menu is shown in for this mind. */
  menuOrder(spec: MindSpec): ActName[];
  /** System layer, then memory, percept and the question, in that order (DESIGN.md section 9). */
  build(spec: MindSpec, layers: PromptLayers): BuiltPrompt;
}

/**
 * Prompt assembly (DESIGN.md section 9). Layers, in order: system prompt (frame, the one given fact, menu, answer
 * form), memory block, percept, question. Every mind gets the same system text, apart from the order of the menu
 * lines and, for the kit slot, the two leaf lines. Every static string is checked against the forbidden-word list
 * when it is built (R2), so a bad edit to a template fails at start-up, not in a live call.
 */
export function createPromptBuilder(options: PromptBuilderOptions): PromptBuilder {
  const { templates, config, lint, runSeed } = options;
  const values = placeholderValues(config);
  const menuLines = parseMenu(templates.menu);
  const question = options.question.trim();
  assertClean(question, lint, "closing question");

  const answerForm = fillPlaceholders(stripComments(templates.answerForm), values);
  assertClean(answerForm, lint, "answer form");
  const frame = stripComments(templates.system);
  if (!frame.includes(MENU_TOKEN) || !frame.includes(FORM_TOKEN)) throw new Error("system template is missing its menu or answer-form placeholder");
  assertClean(frame.replace(MENU_TOKEN, "").replace(FORM_TOKEN, ""), lint, "system template");

  const cache = new Map<string, string>();
  const orderFor = (spec: MindSpec): ActName[] => menuOrder(spec.kit, `${runSeed}|${spec.menuKey ?? spec.mindId}|menu`);

  function system(spec: MindSpec): string {
    const key = `${spec.mindId}|${spec.kit}|${spec.menuKey ?? ""}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const menu = renderMenu(menuLines, orderFor(spec), config);
    const text = frame.replace(MENU_TOKEN, () => menu).replace(FORM_TOKEN, () => answerForm);
    assertClean(text, lint, `system prompt for ${spec.mindId}`);
    cache.set(key, text);
    return text;
  }

  return {
    system,
    menuOrder: orderFor,
    build(spec, layers) {
      const parts = [layers.memory.trim(), layers.percept.trim(), question].filter((p) => p.length > 0);
      return { system: system(spec), user: parts.join("\n\n"), mindId: spec.mindId };
    },
  };
}

export { actsFor };

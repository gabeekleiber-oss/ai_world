import { readFileSync } from "node:fs";
import type { Config } from "@ai-world/shared";
import { FakeProvider } from "./fake";
import { OpenAICompatProvider, type FetchLike } from "./openai-compat";
import { ProviderError, type Provider } from "./types";

export const API_KEY_VARIABLE = "NVIDIA_API_KEY";

/** Parse a .env file body. Supports KEY=value, optional quotes, comments and blank lines. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]!] = value;
  }
  return out;
}

/** Read a .env file if present. Real environment variables win over the file. Returns the merged view. */
export function readEnv(envPath?: string, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  if (!envPath) return base;
  let fromFile: Record<string, string> = {};
  try {
    fromFile = parseDotEnv(readFileSync(envPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ...fromFile, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== "")) };
}

export interface CreateProviderOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

/**
 * Build the provider named by `config.llm.provider`. "fake" needs no key and no network.
 * Anything else is treated as an OpenAI-compatible endpoint (this includes "nvidia-nim").
 * Base URL and model id come from config; the key comes from the environment only.
 */
export function createProvider(llm: Config["llm"], options: CreateProviderOptions = {}): Provider {
  if (llm.provider === "fake") return new FakeProvider();
  const env = options.env ?? process.env;
  const apiKey = env[API_KEY_VARIABLE] ?? "";
  if (!apiKey.trim()) throw new ProviderError("auth", `${API_KEY_VARIABLE} is not set; copy .env.example to .env and add your key`);
  return new OpenAICompatProvider({
    name: llm.provider,
    baseUrl: llm.base_url,
    modelId: llm.model_id,
    apiKey,
    temperature: llm.temperature,
    topP: llm.top_p,
    maxTokens: llm.max_tokens,
    timeoutMs: llm.timeout_s * 1000,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

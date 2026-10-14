# @ai-world/gateway

The only package that talks to a model API (DESIGN.md section 10). This first layer is the provider boundary; the limiter, scheduler, memory and decision pipeline (GW-02 to GW-06) build on it.

## Provider interface

```ts
interface Provider {
  readonly name: string;
  decide(prompt: { system: string; user: string; mindId?; purpose?; maxTokens?; temperature?; topP?; timeoutMs?; signal? }): Promise<{ text: string; usage?; finishReason?; latencyMs }>;
}
```

Failures are thrown as `ProviderError` with a `kind` that maps one-to-one onto the failure table in DESIGN.md section 10: `rate_limit` (carries `retryAfterMs` when the server sent Retry-After), `timeout`, `network`, `server`, `auth` (never retryable), `bad_response`, `aborted`.

## Providers

- `FakeProvider`: offline, deterministic. Script replies and failures with `queue`, `perMind` or function scripts. Default reply is a valid `wait` decision. It records every prompt in `calls`. Use it for all simulation and gateway tests.
- `OpenAICompatProvider`: any OpenAI-compatible `/chat/completions` endpoint, including NVIDIA NIM. Handles timeout, caller cancellation, HTTP status mapping and Retry-After. Takes an injectable `fetchImpl` so tests use mocked HTTP.
- `createProvider(config.llm, { env })`: builds the provider named in config. `"fake"` needs nothing. Anything else is OpenAI-compatible.

## Configuration

Base URL, model id and sampling values come from `config/default.json` (`llm`). The key comes only from the `NVIDIA_API_KEY` environment variable or a gitignored `.env` (`readEnv(path)` merges the file under real environment variables). `model_id` in the default config is a placeholder; `createProvider` refuses to start until it is replaced with the id confirmed on the NVIDIA account page.

## Secrets

The key is held in a private field. It is not included in errors, `toJSON`, `util.inspect` or string conversion, and error text from the server is scrubbed with `redactSecrets` before it is thrown. Nothing in this package logs.

## Tests

`npm test` runs offline. The test setup replaces `globalThis.fetch` with a function that throws, so any accidental real request fails the suite.

import type { Provider, ProviderPrompt, ProviderResponse } from "../provider/types";
import type { GatewayLimiter } from "./limiter";

/**
 * A Provider whose every call goes through the shared limiter. The scheduler (GW-06) and the
 * decision pipeline (GW-04) can take this anywhere they take a Provider, so pacing needs no change
 * on their side.
 */
export class LimitedProvider implements Provider {
  readonly name: string;

  constructor(
    private readonly inner: Provider,
    private readonly limiter: GatewayLimiter,
  ) {
    this.name = inner.name;
  }

  decide(prompt: ProviderPrompt): Promise<ProviderResponse> {
    // A 429 is not retried past the call's own timeout, because the beat barrier would discard the answer.
    const deadlineAt = prompt.timeoutMs !== undefined ? this.limiter.now() + prompt.timeoutMs : undefined;
    return this.limiter.run(() => this.inner.decide(prompt), {
      ...(prompt.signal ? { signal: prompt.signal } : {}),
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    });
  }
}

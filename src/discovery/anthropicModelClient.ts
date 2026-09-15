import Anthropic from '@anthropic-ai/sdk';
import type { ModelClient } from './modelClient.js';

// The live client. It is built with maxRetries 0, because the SDK retries twice by default
// and a retry is another bill for a request that already failed. A failed call returns a
// typed value and the loop ends the run on it. The S2-T01 spike confirmed both properties
// against the real API before this client existed.

export interface AnthropicModelClientOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  // Injected in tests so the error path runs without a network. Production uses the SDK.
  readonly create?: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
}

export interface AnthropicModelClient extends ModelClient {
  readonly client: Anthropic;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function createAnthropicModelClient(options: AnthropicModelClientOptions = {}): AnthropicModelClient {
  const client = new Anthropic({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    maxRetries: 0,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const create = options.create ?? ((params: Anthropic.MessageCreateParamsNonStreaming) => client.messages.create(params));

  return {
    client,
    next: async (request) => {
      try {
        return { ok: true, response: await create(request.params) };
      } catch (error) {
        return { ok: false, failure: 'ModelCallFailed', detail: describe(error) };
      }
    },
  };
}

// The error type and status only. An SDK message is not repeated, so nothing from a request
// or its headers can reach a log through this detail.
function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.name} with status ${String(error.status)}.`;
  if (error instanceof Error) return `${error.name}.`;
  return 'An unknown error.';
}

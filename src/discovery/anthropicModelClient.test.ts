import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createAnthropicModelClient } from './anthropicModelClient.js';
import type { ModelRequest } from './modelClient.js';

// No test reads ANTHROPIC_API_KEY, see docs/TESTING.md section 4. The key below is never sent.
const apiKey = 'sk-ant-test-never-sent';

const request: ModelRequest = {
  params: { model: 'claude-sonnet-5', max_tokens: 8000, messages: [{ role: 'user', content: 'Goal' }] },
  observationHash: 'aaaa',
};

describe('AnthropicModelClient', () => {
  it('builds the SDK client with maxRetries 0, so a failed request is never billed twice', () => {
    expect(createAnthropicModelClient({ apiKey }).client.maxRetries).toBe(0);
  });

  it('returns an API error as a typed failure after exactly one attempt', async () => {
    let attempts = 0;
    const model = createAnthropicModelClient({
      apiKey,
      create: async () => {
        attempts += 1;
        throw new Anthropic.APIError(529, undefined, 'Overloaded', undefined);
      },
    });

    const result = await model.next(request);

    expect(result).toMatchObject({ ok: false, failure: 'ModelCallFailed' });
    expect(attempts).toBe(1);
  });

  it('names the error and its status in the detail, and never the key', async () => {
    const model = createAnthropicModelClient({
      apiKey,
      create: async () => {
        throw new Anthropic.APIError(401, undefined, 'invalid x-api-key', undefined);
      },
    });

    const result = await model.next(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('401');
    expect(result.detail).not.toContain(apiKey);
  });

  it('passes the request through and returns the response when the call succeeds', async () => {
    const response = { id: 'msg_1', type: 'message', role: 'assistant', content: [], stop_reason: 'end_turn' } as unknown as Anthropic.Message;
    const model = createAnthropicModelClient({ apiKey, create: async (params) => (params.model === 'claude-sonnet-5' ? response : Promise.reject(new Error('wrong model'))) });

    expect(await model.next(request)).toEqual({ ok: true, response });
  });
});

import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createFakeModelClient } from './fakeModelClient.js';
import type { ModelRequest } from './modelClient.js';

function toolUse(id: string, name: string, input: Record<string, unknown>): Anthropic.Message {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'tool_use', id: `toolu_${id}`, name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function request(observationHash: string): ModelRequest {
  return { params: { model: 'claude-sonnet-5', max_tokens: 8000, messages: [{ role: 'user', content: 'Goal' }] }, observationHash };
}

describe('FakeModelClient', () => {
  it('returns scripted responses in order and records every request it was given', async () => {
    const client = createFakeModelClient([{ respond: toolUse('m1', 'click', { ref: 'f3e24' }) }, { respond: toolUse('m2', 'done', {}) }]);

    expect(await client.next(request('aaaa'))).toMatchObject({ ok: true, response: { id: 'm1' } });
    expect(await client.next(request('bbbb'))).toMatchObject({ ok: true, response: { id: 'm2' } });
    expect(client.requests.map((sent) => sent.observationHash)).toEqual(['aaaa', 'bbbb']);
  });

  it('returns a scripted failure as a typed ModelCallFailed', async () => {
    const client = createFakeModelClient([{ fail: 'OverloadedError with status 529.' }]);

    expect(await client.next(request('aaaa'))).toEqual({ ok: false, failure: 'ModelCallFailed', detail: 'OverloadedError with status 529.' });
  });

  it('fails loudly when asked for a turn past the end of its script', async () => {
    const client = createFakeModelClient([{ respond: toolUse('m1', 'done', {}) }]);
    await client.next(request('aaaa'));

    await expect(client.next(request('bbbb'))).rejects.toThrow(/script of 1 turn/);
  });
});

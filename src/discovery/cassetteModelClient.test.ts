import type Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Cassette, CassetteMismatch, createCassetteModelClient } from './cassetteModelClient.js';
import type { ModelRequest } from './modelClient.js';

const tools: Anthropic.Tool[] = [
  {
    name: 'click',
    description: 'Click the element with this ref.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false },
  },
  { name: 'done', description: 'Finish.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
];

function message(id: string, name: string, input: Record<string, unknown>): unknown {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'tool_use', id: `toolu_${id}`, name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const recorded = {
  recordedAt: '2026-09-15T02:08:36.117Z',
  source: 'unit test',
  runId: 'run_000001',
  model: 'claude-sonnet-5',
  system: 'You operate a legacy back office banking application.',
  goal: 'Goal: read the balance of {{inputs.memberId}}.',
  inputNames: ['memberId'],
  tools,
  exchanges: [
    { index: 0, observationHash: 'aaaa', observationText: 'frame content\n  [f3e24] cell "Search" clickable', response: message('m1', 'click', { ref: 'f3e24' }) },
    { index: 1, observationHash: 'bbbb', observationText: 'frame content\n  [f3e32] link "{{inputs.memberId}}"', response: message('m2', 'done', {}) },
  ],
};

function request(observationHash: string, options: { text?: string; tools?: Anthropic.Tool[]; system?: string } = {}): ModelRequest {
  return {
    params: {
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system: options.system ?? recorded.system,
      tools: options.tools ?? tools,
      messages: [{ role: 'user', content: 'Goal' }],
    },
    observationHash,
    ...(options.text === undefined ? {} : { observationText: options.text }),
  };
}

async function mismatchOf(attempt: Promise<unknown>): Promise<CassetteMismatch> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof CassetteMismatch) return error;
    throw error;
  }
  throw new Error('Expected a CassetteMismatch, and the cassette replayed instead.');
}

describe('CassetteModelClient', () => {
  it('returns exchange N for the Nth call, the same on every replay', async () => {
    for (const client of [createCassetteModelClient(Cassette.parse(recorded)), createCassetteModelClient(Cassette.parse(recorded))]) {
      expect(await client.next(request('aaaa'))).toMatchObject({ ok: true, response: { id: 'm1' } });
      expect(await client.next(request('bbbb'))).toMatchObject({ ok: true, response: { id: 'm2' } });
    }
  });

  it('fails with a diff naming the exchange when what the model is shown has changed', async () => {
    const client = createCassetteModelClient(Cassette.parse(recorded));
    await client.next(request('aaaa'));

    const mismatch = await mismatchOf(client.next(request('cccc', { text: 'frame content\n  [f3e32] link "[redacted:pii]"' })));

    expect(mismatch.message).toContain('exchange 1');
    expect(mismatch.message).toContain('- [f3e32] link "{{inputs.memberId}}"');
    expect(mismatch.message).toContain('+ [f3e32] link "[redacted:pii]"');
  });

  it('fails when a tool is renamed or its input schema changes, naming the tool', async () => {
    const renamed = tools.map((tool) => (tool.name === 'click' ? { ...tool, name: 'tap' } : tool));
    const reshaped = tools.map((tool) =>
      tool.name === 'click' ? { ...tool, input_schema: { type: 'object' as const, properties: { ref: { type: 'number' } }, required: ['ref'] } } : tool,
    );

    expect((await mismatchOf(createCassetteModelClient(Cassette.parse(recorded)).next(request('aaaa', { tools: renamed })))).message).toMatch(/tap|click/);
    expect((await mismatchOf(createCassetteModelClient(Cassette.parse(recorded)).next(request('aaaa', { tools: reshaped })))).message).toContain('click');
  });

  it('lets tool descriptions and the system prompt change without a re record', async () => {
    const reworded = tools.map((tool) => ({ ...tool, description: `${tool.description ?? ''} Reworded.` }));
    const client = createCassetteModelClient(Cassette.parse(recorded));

    expect(await client.next(request('aaaa', { tools: reworded, system: 'A different system prompt.' }))).toMatchObject({ ok: true, response: { id: 'm1' } });
  });

  it('fails loudly when asked for more exchanges than were recorded', async () => {
    const client = createCassetteModelClient(Cassette.parse(recorded));
    await client.next(request('aaaa'));
    await client.next(request('bbbb'));

    expect((await mismatchOf(client.next(request('dddd')))).message).toContain('recorded 2 exchanges');
  });

  it('loads the committed S2-T01 cassette and replays its first exchange', async () => {
    const committed = Cassette.parse(JSON.parse(await readFile('tests/fixtures/cassettes/discovery.readSavingsBalance.json', 'utf8')));
    const [first] = committed.exchanges;
    if (first === undefined) throw new Error('The committed cassette has no exchanges.');

    const result = await createCassetteModelClient(committed).next(request(first.observationHash, { tools: committed.tools, text: first.observationText }));

    expect(result).toMatchObject({ ok: true, response: { content: expect.arrayContaining([expect.objectContaining({ type: 'tool_use', name: 'fill' })]) } });
  });
});

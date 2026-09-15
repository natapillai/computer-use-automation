import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Cassette, createCassetteModelClient } from './cassetteModelClient.js';
import { DISCOVERY_TOOLS, toolsFor } from './tools.js';

describe('toolsFor', () => {
  const tools = toolsFor(['memberId']);

  it('offers exactly the refs only tool set, and never waitFor or assert', () => {
    expect(tools.map((tool) => tool.name)).toEqual([...DISCOVERY_TOOLS]);
    expect(tools.map((tool) => tool.name)).not.toContain('waitFor');
    expect(tools.map((tool) => tool.name)).not.toContain('assert');
  });

  it('lets fill and select name a declared input, and never take a value the model wrote', () => {
    for (const name of ['fill', 'select']) {
      const tool = tools.find((candidate) => candidate.name === name);
      const properties = tool?.input_schema.properties;
      expect(properties, name).toMatchObject({ ref: { type: 'string' }, input: { type: 'string', enum: ['memberId'] } });
      expect(Object.keys(properties ?? {}), name).toEqual(['ref', 'input']);
    }
  });

  it('never takes a selector, a coordinate or free text to type', () => {
    expect(JSON.stringify(tools)).not.toMatch(/selector|xpath|css|coordinate|"value"|"text"/);
  });

  it('keeps the tool names and input schemas the S2-T01 cassette recorded', async () => {
    const committed = Cassette.parse(JSON.parse(await readFile('tests/fixtures/cassettes/discovery.readSavingsBalance.json', 'utf8')));
    const [first] = committed.exchanges;
    if (first === undefined) throw new Error('The committed cassette has no exchanges.');

    const result = await createCassetteModelClient(committed).next({
      params: { model: committed.model, max_tokens: 8000, tools, messages: [{ role: 'user', content: 'Goal' }] },
      observationHash: first.observationHash,
    });

    expect(result.ok).toBe(true);
  });
});

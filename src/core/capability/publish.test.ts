import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../../tests/fixtures/capabilities/readSavingsBalance.js';
import { Capability } from './schema.js';
import { artifactJsonSchema, reviewSheet, toolFor } from './publish.js';

// S7-T02. Two audiences read a capability. A calling agent needs a contract it can invoke
// against, and a person needs to decide whether to approve it. Both are generated, because a
// hand written copy of a schema is a second source of truth that drifts from the first one.

const capability = Capability.parse(readSavingsBalanceFixture());

describe('artifactJsonSchema', () => {
  it('is generated from the Zod schema the executor validates against', () => {
    const schema = artifactJsonSchema();

    // Not a hand written copy. It carries the fields the schema carries, so a consumer that
    // validates against it is validating against what replay enforces.
    expect(schema).toMatchObject({ type: 'object' });
    const properties = Reflect.get(schema, 'properties');
    expect(Object.keys(properties as object)).toEqual(expect.arrayContaining(['id', 'version', 'steps', 'outputs', 'outcomes', 'policy', 'lifecycle']));
  });
});

describe('toolFor', () => {
  it('names the capability and every declared input with its type', () => {
    const tool = toolFor(capability);

    expect(tool.name).toBe('member_readSavingsBalance');
    expect(tool.description).toContain(capability.description);
    expect(tool.input_schema.properties).toMatchObject({ memberId: { type: 'string' } });
    expect(tool.input_schema.required).toEqual(['memberId']);
  });

  it('carries the constraints the executor would refuse on, so a caller can get it right first', () => {
    const tool = toolFor(capability);
    const memberId = Reflect.get(tool.input_schema.properties, 'memberId');

    expect(memberId).toMatchObject({ pattern: '^[0-9]{5,10}$' });
  });

  it('never leaks a value, only the shape of one', () => {
    expect(JSON.stringify(toolFor(capability))).not.toContain('10001');
  });

  it('marks an optional input as not required rather than dropping it', () => {
    const optional = Capability.parse({
      ...readSavingsBalanceFixture(),
      inputs: [
        ...readSavingsBalanceFixture().inputs,
        { name: 'asOfDate', type: 'date', required: false, description: 'The date to read the balance as of', sensitivity: 'internal' },
      ],
    });

    const tool = toolFor(optional);

    expect(Object.keys(tool.input_schema.properties)).toEqual(['memberId', 'asOfDate']);
    expect(tool.input_schema.required).toEqual(['memberId']);
  });
});

describe('reviewSheet', () => {
  it('lists what the capability does, step by step, in the order it does it', () => {
    const sheet = reviewSheet(capability);

    for (const step of capability.steps) expect(sheet).toContain(step.intent);
    expect(sheet.indexOf(capability.steps[0]?.intent ?? '')).toBeLessThan(sheet.indexOf(capability.steps[1]?.intent ?? ''));
  });

  it('lists every input, every output and every declared outcome', () => {
    const declared = Capability.parse({
      ...readSavingsBalanceFixture(),
      outcomes: [{ code: 'MEMBER_NOT_FOUND', description: 'No member exists with the supplied ID.', terminal: true, detect: readSavingsBalanceFixture().steps[1]?.postcondition.condition }],
    });

    const sheet = reviewSheet(declared);

    expect(sheet).toContain('memberId');
    expect(sheet).toContain('savingsBalance');
    expect(sheet).toContain('MEMBER_NOT_FOUND');
    expect(sheet).toContain('No member exists with the supplied ID.');
  });

  it('says whether the capability writes and whether it may run unattended, because that is what approval is about', () => {
    const sheet = reviewSheet(capability);

    expect(sheet).toContain('read');
    expect(sheet.toLowerCase()).toContain('unattended');
  });

  it('carries no value of any input, because a sheet is read and passed around', () => {
    expect(reviewSheet(capability)).not.toContain('10001');
  });
});

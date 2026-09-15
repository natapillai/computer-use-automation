import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../../tests/fixtures/capabilities/readSavingsBalance.js';
import { Capability, type CapabilityInput } from '../capability/schema.js';
import { higherSensitivity, outputSensitivities, redactionContextFor } from './sensitivity.js';

// The fixture with an extra output that reads back the member ID field the fill step
// typed into, so its sensitivity can only come from the input that fed it.
function withEchoedId(inputSensitivity: 'pii' | 'secret', declared: 'public' | 'secret' = 'public'): Capability {
  const fixture = readSavingsBalanceFixture();
  const fill = fixture.steps[1];
  if (fill?.target === undefined) throw new Error('The fixture fill step has no target.');
  const input: CapabilityInput = {
    ...fixture,
    inputs: fixture.inputs.map((spec) => ({ ...spec, sensitivity: inputSensitivity })),
    outputs: [
      ...fixture.outputs,
      {
        name: 'echoedId',
        type: 'string',
        required: false,
        sensitivity: declared,
        description: 'The member ID as the search field shows it',
        source: { stepId: 'fillMemberId', target: fill.target },
      },
    ],
  };
  return Capability.parse(input);
}

describe('sensitivity propagation', () => {
  it('orders public below internal below pii below secret', () => {
    expect(higherSensitivity('internal', 'pii')).toBe('pii');
    expect(higherSensitivity('secret', 'public')).toBe('secret');
    expect(higherSensitivity('public', 'internal')).toBe('internal');
  });

  it('makes a money output at least pii even when it is declared public', () => {
    const fixture = readSavingsBalanceFixture();
    const capability = Capability.parse({ ...fixture, outputs: fixture.outputs.map((output) => ({ ...output, sensitivity: 'public' })) });

    expect(outputSensitivities(capability)['savingsBalance']).toBe('pii');
  });

  it('lifts an output read from a field that a pii input filled', () => {
    expect(outputSensitivities(withEchoedId('pii'))['echoedId']).toBe('pii');
  });

  it('lifts it to secret when the input that filled the field is secret', () => {
    expect(outputSensitivities(withEchoedId('secret'))['echoedId']).toBe('secret');
  });

  it('never lowers a declared sensitivity', () => {
    expect(outputSensitivities(withEchoedId('pii', 'secret'))['echoedId']).toBe('secret');
  });
});

describe('redactionContextFor', () => {
  it('knows sensitive input values as templates and sensitive output values as markers, and skips public inputs', () => {
    const fixture = readSavingsBalanceFixture();
    const capability = Capability.parse({
      ...fixture,
      inputs: [...fixture.inputs, { name: 'branch', type: 'string', required: false, sensitivity: 'public', description: 'Branch name' }],
    });

    const context = redactionContextFor(capability, { memberId: '10001', branch: 'Main' }, {
      savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' },
    });

    expect(context.known).toEqual([
      { value: '10001', replacement: '{{inputs.memberId}}' },
      { value: '$4,250.75', replacement: '[redacted:pii]' },
    ]);
  });
});

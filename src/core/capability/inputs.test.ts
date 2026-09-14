import { describe, expect, it } from 'vitest';
import { ParamSpec } from './schema.js';
import { validateInputs } from './inputs.js';

const specs = [
  ParamSpec.parse({
    name: 'memberId',
    type: 'string',
    required: true,
    description: 'Institution member number',
    sensitivity: 'pii',
    constraints: { pattern: '^[0-9]{5,10}$' },
  }),
  ParamSpec.parse({
    name: 'amount',
    type: 'number',
    required: false,
    description: 'Opening amount in dollars',
    sensitivity: 'internal',
    constraints: { min: 10, max: 10_000 },
  }),
  ParamSpec.parse({
    name: 'accountType',
    type: 'enum',
    enumValues: ['savings', 'checking'],
    required: false,
    description: 'Sub account type',
    sensitivity: 'public',
  }),
  ParamSpec.parse({
    name: 'note',
    type: 'string',
    required: false,
    description: 'Short note',
    sensitivity: 'internal',
    constraints: { minLength: 2, maxLength: 3 },
  }),
];

describe('validateInputs', () => {
  it('accepts inputs that satisfy every constraint and reports their names in a stable order', () => {
    expect(validateInputs(specs, { memberId: '10001', amount: 250, accountType: 'savings' })).toEqual({
      ok: true,
      values: { memberId: '10001', amount: 250, accountType: 'savings' },
      inputNames: ['accountType', 'amount', 'memberId'],
    });
  });

  it('names a missing required input', () => {
    expect(validateInputs(specs, {})).toEqual({
      ok: false,
      failure: 'InputValidation',
      problems: [{ input: 'memberId', message: 'memberId is required.' }],
    });
  });

  it('rejects a value that does not match its pattern without echoing the value', () => {
    const result = validateInputs(specs, { memberId: 'abc12' });

    expect(result).toEqual({
      ok: false,
      failure: 'InputValidation',
      problems: [{ input: 'memberId', message: 'memberId does not match its declared pattern.' }],
    });
    expect(JSON.stringify(result)).not.toContain('abc12');
  });

  it('enforces min and max on a number', () => {
    expect(validateInputs(specs, { memberId: '10001', amount: 5 })).toMatchObject({
      ok: false,
      problems: [{ input: 'amount', message: 'amount must be at least 10.' }],
    });
    expect(validateInputs(specs, { memberId: '10001', amount: 20_000 })).toMatchObject({
      ok: false,
      problems: [{ input: 'amount', message: 'amount must be at most 10000.' }],
    });
  });

  it('enforces minLength and maxLength on a string', () => {
    expect(validateInputs(specs, { memberId: '10001', note: 'abcd' })).toMatchObject({
      ok: false,
      problems: [{ input: 'note', message: 'note must be at most 3 characters.' }],
    });
    expect(validateInputs(specs, { memberId: '10001', note: 'a' })).toMatchObject({
      ok: false,
      problems: [{ input: 'note', message: 'note must be at least 2 characters.' }],
    });
  });

  it('rejects a value outside its enum', () => {
    expect(validateInputs(specs, { memberId: '10001', accountType: 'brokerage' })).toMatchObject({
      ok: false,
      problems: [{ input: 'accountType', message: 'accountType must be one of savings, checking.' }],
    });
  });

  it('rejects a value of the wrong type', () => {
    expect(validateInputs(specs, { memberId: '10001', amount: '250' })).toMatchObject({
      ok: false,
      problems: [{ input: 'amount', message: 'amount must be a number.' }],
    });
  });

  it('rejects an input the capability does not declare', () => {
    expect(validateInputs(specs, { memberId: '10001', surname: 'Member' })).toMatchObject({
      ok: false,
      problems: [{ input: 'surname', message: 'surname is not a declared input.' }],
    });
  });
});

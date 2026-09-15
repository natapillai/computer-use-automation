import { describe, expect, it } from 'vitest';
import { createRedactor } from '../redaction/redactor.js';
import { findSensitiveLiterals, type LiteralScanContext } from './sensitiveLiterals.js';

const redactor = createRedactor({ neverPersist: [], redactPatterns: [{ name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' }] });
const inputs: LiteralScanContext['inputs'] = [
  { name: 'memberId', sensitivity: 'pii' },
  { name: 'accountType', sensitivity: 'internal' },
];

describe('findSensitiveLiterals', () => {
  it('names a pii input whose value appears as a whole token, never the value', () => {
    const found = findSensitiveLiterals('{"describedAs":"link 10001"}', { inputs, inputValues: { memberId: '10001', accountType: 'Savings' }, redactor });

    expect(found).toEqual(['input memberId']);
  });

  it('ignores a value inside a longer number and an input that is not sensitive', () => {
    const found = findSensitiveLiterals('{"a":"100012","b":"Savings"}', { inputs, inputValues: { memberId: '10001', accountType: 'Savings' }, redactor });

    expect(found).toEqual([]);
  });

  it('names the redactor pattern that would hide part of the text', () => {
    expect(findSensitiveLiterals('Card 4111 1111 1111 1111', { inputs, inputValues: {}, redactor })).toEqual(['pattern cardNumber']);
  });
});

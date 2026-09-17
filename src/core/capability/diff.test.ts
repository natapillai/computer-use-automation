import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../../tests/fixtures/capabilities/readSavingsBalance.js';
import { capabilityDiff } from './diff.js';
import { Capability } from './schema.js';

const base = (): Capability => Capability.parse(readSavingsBalanceFixture());

describe('capabilityDiff', () => {
  it('is empty for two capabilities that are the same', () => {
    expect(capabilityDiff(base(), base())).toEqual([]);
  });

  it('names a changed field with what it was and what it became', () => {
    const after = Capability.parse({ ...readSavingsBalanceFixture(), version: '1.1.0' });

    expect(capabilityDiff(base(), after)).toEqual([{ path: 'version', kind: 'changed', before: '1.0.0', after: '1.1.0' }]);
  });

  it('names an added outcome by its path and reports nothing else', () => {
    const fixture = readSavingsBalanceFixture();
    const [outcome] = fixture.outcomes;
    if (outcome === undefined) throw new Error('The fixture declares no outcome.');
    const after = Capability.parse({ ...fixture, outcomes: [outcome, { ...outcome, code: 'ACCOUNT_RESTRICTED', description: 'The operator may not view this member.' }] });

    expect(capabilityDiff(base(), after)).toEqual([{ path: 'outcomes.1', kind: 'added', after: expect.objectContaining({ code: 'ACCOUNT_RESTRICTED' }) }]);
  });

  it('names a removed outcome by its path', () => {
    const fixture = readSavingsBalanceFixture();
    const [outcome] = fixture.outcomes;
    if (outcome === undefined) throw new Error('The fixture declares no outcome.');
    const extra = Capability.parse({ ...fixture, outcomes: [outcome, { ...outcome, code: 'ACCOUNT_RESTRICTED', description: 'The operator may not view this member.' }] });

    expect(capabilityDiff(extra, base())).toEqual([{ path: 'outcomes.1', kind: 'removed', before: expect.objectContaining({ code: 'ACCOUNT_RESTRICTED' }) }]);
  });
});

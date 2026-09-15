import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../../tests/fixtures/capabilities/readSavingsBalance.js';
import { Capability } from '../capability/schema.js';
import { businessOutcomeResult, failureResult, successResult, type ResultBaseInput } from '../outcome/result.js';
import { createRedactor } from './redactor.js';
import { persistedResult } from './resultProjection.js';

const redactor = createRedactor({ neverPersist: [], redactPatterns: [] });
const base: ResultBaseInput = {
  runId: 'run_000001',
  capability: { id: 'member.readSavingsBalance', version: '1.0.0' },
  inputNames: ['memberId'],
  startedAt: '2026-09-15T09:00:00.000Z',
  endedAt: '2026-09-15T09:00:02.000Z',
  stepsAttempted: 4,
  stepsCompleted: 4,
};
const balance = { type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' } as const;

function withPublicSuffix(): Capability {
  const fixture = readSavingsBalanceFixture();
  const [savings] = fixture.outputs;
  if (savings === undefined) throw new Error('The fixture has no output.');
  return Capability.parse({ ...fixture, outputs: [savings, { ...savings, name: 'accountSuffix', type: 'string', sensitivity: 'public', description: 'The account suffix', source: { ...savings.source, parse: undefined } }] });
}

describe('persistedResult', () => {
  it('hides a money output whole, the amount in minor units included, and keeps the run facts', () => {
    const persisted = persistedResult(successResult(base, { savingsBalance: balance }), Capability.parse(readSavingsBalanceFixture()), { memberId: '10001' }, redactor);

    expect(persisted).toMatchObject({ runId: 'run_000001', status: 'success', outputs: { savingsBalance: { type: 'money', redacted: '[redacted:pii]' } } });
    expect(JSON.stringify(persisted)).not.toMatch(/425075|4,250\.75/);
  });

  it('keeps an output declared public', () => {
    const persisted = persistedResult(successResult(base, { savingsBalance: balance, accountSuffix: { type: 'string', value: 'S01' } }), withPublicSuffix(), { memberId: '10001' }, redactor);

    expect(persisted).toMatchObject({ outputs: { accountSuffix: { type: 'string', value: 'S01' } } });
  });

  it('hides an output the capability never declared, because nothing says it is safe', () => {
    const persisted = persistedResult(successResult(base, { surprise: { type: 'string', value: 'Test Member One' } }), Capability.parse(readSavingsBalanceFixture()), { memberId: '10001' }, redactor);

    expect(JSON.stringify(persisted)).not.toContain('Test Member One');
  });

  it('hides business outcome data and writes a supplied member id in failure text as its template', () => {
    const capability = Capability.parse(readSavingsBalanceFixture());
    const outcome = persistedResult(
      businessOutcomeResult(base, { code: 'MEMBER_NOT_FOUND', description: 'No member exists with the supplied ID.', terminal: true, data: { searchedName: { type: 'string', value: 'Test Member One' } } }),
      capability,
      { memberId: '10001' },
      redactor,
    );
    const failure = persistedResult(
      failureResult(base, { class: 'CheckpointFailed', atStepId: 'submitSearch', stepIntent: 'Submit the member search form', expected: 'A result row for member 10001.', observed: 'No row for 10001.', retryable: false }),
      capability,
      { memberId: '10001' },
      redactor,
    );

    expect(JSON.stringify(outcome)).not.toContain('Test Member One');
    expect(outcome).toMatchObject({ outcome: { code: 'MEMBER_NOT_FOUND' } });
    expect(JSON.stringify(failure)).not.toContain('10001');
    expect(failure).toMatchObject({ failure: { observed: 'No row for {{inputs.memberId}}.' } });
  });
});

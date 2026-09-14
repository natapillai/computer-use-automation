import { describe, expect, it } from 'vitest';
import { FAILURE_CLASSES, failureResult, successResult } from './result.js';

const base = {
  runId: 'run_000001',
  capability: { id: 'member.readSavingsBalance', version: '1.0.0' },
  inputNames: ['memberId', 'accountType'],
  startedAt: '2026-09-14T09:00:00.000Z',
  endedAt: '2026-09-14T09:00:04.000Z',
  stepsAttempted: 2,
  stepsCompleted: 1,
};

const failure = {
  atStepId: 'fillMemberId',
  stepIntent: 'Enter the member ID',
  expected: 'the Member ID input in frame content',
  observed: 'no element matched any strategy',
  retryable: false,
};

describe('result constructors', () => {
  it('construct a failure for every class, each carrying expected and observed', () => {
    for (const failureClass of FAILURE_CLASSES) {
      const result = failureResult(base, { ...failure, class: failureClass });

      expect(result.status).toBe('failure');
      expect(result.runId).toBe('run_000001');
      expect(result.failure).toMatchObject({ class: failureClass, expected: failure.expected, observed: failure.observed });
    }
  });

  it('refuse a failure that does not say what was expected', () => {
    expect(() => failureResult(base, { ...failure, class: 'CheckpointFailed', expected: '  ' })).toThrow(
      'A failure must state what was expected.',
    );
  });

  it('refuse a failure that does not say what was observed', () => {
    expect(() => failureResult(base, { ...failure, class: 'CheckpointFailed', observed: '' })).toThrow(
      'A failure must state what was observed.',
    );
  });

  it('always carry recoveries, interventions and drift, even when nothing happened', () => {
    expect(successResult(base, {})).toMatchObject({
      runId: 'run_000001',
      capability: { id: 'member.readSavingsBalance', version: '1.0.0' },
      recoveries: [],
      interventions: [],
      drift: [],
    });
  });

  it('report input names in a stable order', () => {
    expect(successResult(base, {}).inputNames).toEqual(['accountType', 'memberId']);
  });
});

import { describe, expect, it } from 'vitest';
import { businessOutcomeResult, escalatedResult, FAILURE_CLASSES, failureResult, successResult } from './result.js';

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

  it('carry all three on every shape a result can take, not only on success', () => {
    const shapes = [
      successResult(base, {}),
      businessOutcomeResult(base, { code: 'MEMBER_NOT_FOUND', description: 'No member exists with the supplied ID.', terminal: true }),
      failureResult(base, { ...failure, class: 'CheckpointFailed' }),
      escalatedResult(base, { id: 'int_000001', reason: 'NoProgress', atStepId: null, disposition: 'unclaimed' }),
    ];

    // A caller that has to ask which shape it got before it knows whether a field is there is
    // a caller that will forget. Every result answers all three questions.
    for (const shape of shapes) {
      expect(Array.isArray(shape.recoveries), shape.status).toBe(true);
      expect(Array.isArray(shape.interventions), shape.status).toBe(true);
      expect(Array.isArray(shape.drift), shape.status).toBe(true);
    }
    expect(shapes.map((shape) => shape.status)).toEqual(['success', 'business_outcome', 'failure', 'escalated']);
  });

  it('report input names in a stable order', () => {
    expect(successResult(base, {}).inputNames).toEqual(['accountType', 'memberId']);
  });
});

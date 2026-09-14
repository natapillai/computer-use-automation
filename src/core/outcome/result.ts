import type { DriftRecord, LocatorAttempt } from '../locator/resolve.js';

// The replay result contract. See docs/ERROR_TAXONOMY.md section 2.

export const FAILURE_CLASSES = [
  'LocatorNotFound',
  'LocatorAmbiguous',
  'CheckpointFailed',
  'PreconditionFailed',
  'Timeout',
  'SessionExpired',
  'PolicyDenied',
  'ControlLost',
  'OutputUnresolvable',
  'SurfaceUnavailable',
  'InputValidation',
  'SchemaIncompatible',
  'Internal',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export type TypedValue =
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'date'; readonly value: string }
  | { readonly type: 'money'; readonly amountMinor: number; readonly currency: string; readonly raw: string };

export type EscalationReason =
  | 'NoProgress'
  | 'UnclassifiedCondition'
  | 'ModelRequested'
  | 'PolicyConfirmation'
  | 'resumePreconditionFailed';

export interface RecoveryRecord {
  readonly condition: 'TransientLoad';
  readonly atStepId: string;
  readonly attempt: number;
  readonly resolved: boolean;
}

export interface InterventionRecord {
  readonly interventionId: string;
  readonly reason: EscalationReason;
  readonly atStepId: string | null;
  readonly disposition: 'resumed' | 'unclaimed' | 'aborted';
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface EvidenceBundle {
  readonly runDirectory: string | null;
}

export interface ResultBase {
  readonly runId: string;
  readonly capability: { readonly id: string; readonly version: string };
  readonly inputNames: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly stepsAttempted: number;
  readonly stepsCompleted: number;
  readonly recoveries: readonly RecoveryRecord[];
  readonly interventions: readonly InterventionRecord[];
  readonly drift: readonly DriftRecord[];
  readonly evidence: EvidenceBundle;
}

export interface SuccessResult extends ResultBase {
  readonly status: 'success';
  readonly outputs: Readonly<Record<string, TypedValue>>;
}

export interface BusinessOutcome {
  readonly code: string;
  readonly description: string;
  readonly terminal: boolean;
  readonly data?: Readonly<Record<string, TypedValue>>;
}

export interface BusinessOutcomeResult extends ResultBase {
  readonly status: 'business_outcome';
  readonly outcome: BusinessOutcome;
  readonly partialOutputs?: Readonly<Record<string, TypedValue>>;
}

export interface EscalatedResult extends ResultBase {
  readonly status: 'escalated';
  readonly intervention: {
    readonly id: string;
    readonly reason: EscalationReason;
    readonly atStepId: string | null;
    readonly disposition: 'unclaimed' | 'aborted';
  };
}

// atStepId is null only when the run failed before its first step, for example on
// input validation or an incompatible schema.
export interface FailureDetail {
  readonly class: FailureClass;
  readonly atStepId: string | null;
  readonly stepIntent: string | null;
  readonly expected: string;
  readonly observed: string;
  readonly locatorAttempts?: readonly LocatorAttempt[];
  readonly cause?: string;
  readonly retryable: boolean;
}

export interface FailureResult extends ResultBase {
  readonly status: 'failure';
  readonly failure: FailureDetail;
}

export type ReplayResult = SuccessResult | BusinessOutcomeResult | EscalatedResult | FailureResult;

export interface ResultBaseInput {
  readonly runId: string;
  readonly capability: { readonly id: string; readonly version: string };
  readonly inputNames: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly stepsAttempted: number;
  readonly stepsCompleted: number;
  readonly recoveries?: readonly RecoveryRecord[];
  readonly interventions?: readonly InterventionRecord[];
  readonly drift?: readonly DriftRecord[];
  readonly evidence?: EvidenceBundle;
}

// recoveries, interventions and drift are always present, including on success. A run
// that needed three retries and a human is not the same as a clean run, and a field
// that is sometimes absent is how that difference goes unnoticed.
function baseOf(input: ResultBaseInput): ResultBase {
  return {
    runId: input.runId,
    capability: { id: input.capability.id, version: input.capability.version },
    inputNames: [...input.inputNames].sort(),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    stepsAttempted: input.stepsAttempted,
    stepsCompleted: input.stepsCompleted,
    recoveries: input.recoveries ?? [],
    interventions: input.interventions ?? [],
    drift: input.drift ?? [],
    evidence: input.evidence ?? { runDirectory: null },
  };
}

export function successResult(input: ResultBaseInput, outputs: Readonly<Record<string, TypedValue>>): SuccessResult {
  return { ...baseOf(input), status: 'success', outputs };
}

export function businessOutcomeResult(input: ResultBaseInput, outcome: BusinessOutcome): BusinessOutcomeResult {
  return { ...baseOf(input), status: 'business_outcome', outcome };
}

export function escalatedResult(input: ResultBaseInput, intervention: EscalatedResult['intervention']): EscalatedResult {
  return { ...baseOf(input), status: 'escalated', intervention };
}

// A failure that cannot say what was expected and what was observed is not debuggable,
// which is the whole point of the failure branch. A blank string here is a programming
// error at the construction site, so it throws rather than producing a result.
export function failureResult(input: ResultBaseInput, failure: FailureDetail): FailureResult {
  if (failure.expected.trim() === '') throw new TypeError('A failure must state what was expected.');
  if (failure.observed.trim() === '') throw new TypeError('A failure must state what was observed.');
  return { ...baseOf(input), status: 'failure', failure };
}

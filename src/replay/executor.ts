import { ControlLostError, type ControlToken } from '../control/controlToken.js';
import { validateInputs } from '../core/capability/inputs.js';
import { resolveTemplate, type TemplateValues } from '../core/capability/resolveTemplate.js';
import type { Capability, Step } from '../core/capability/schema.js';
import { templateBundle, templateCondition, type Templated } from '../core/capability/templateCondition.js';
import type { DriftRecord } from '../core/locator/resolve.js';
import {
  businessOutcomeResult,
  failureResult,
  successResult,
  type FailureDetail,
  type ReplayResult,
  type ResultBaseInput,
  type TypedValue,
} from '../core/outcome/result.js';
import { fingerprint } from '../core/surfaceModel/fingerprint.js';
import type { ActionResult, ResolvedAction } from '../core/surfaceModel/types.js';
import type { Clock } from '../runtime/clock.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';
import { extractOutput } from './extract.js';
import { race, type Contender } from './race.js';

// Deterministic replay, see docs/ARCHITECTURE.md section 7. No model is constructed on
// this path. Each step resolves its target, is authorized and performed through the
// guarded surface, then races its postcondition against every detector, and the winner
// decides whether the run advances, ends as a business outcome, or fails with a class
// that says what was expected and what was observed.

export interface ReplayContext {
  readonly surface: GuardedSurface;
  readonly control: ControlToken;
  readonly clock: Clock;
  readonly runId: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly allowedEnv?: readonly string[];
}

type RuleClass = Step['onCondition'][number]['classify'];

type Entrant =
  | { readonly kind: 'rule'; readonly code: string; readonly classify: RuleClass }
  | { readonly kind: 'outcome'; readonly code: string }
  | { readonly kind: 'postcondition' };

type FailureInput = Omit<FailureDetail, 'atStepId' | 'stepIntent'> & Partial<Pick<FailureDetail, 'stepIntent'>>;

interface PreparedAction {
  readonly action: ResolvedAction;
  readonly framePath: readonly string[];
  readonly targetKey: string | null;
}

// The entry point is not a step, so it has no step id of its own to bind a grant to.
const ENTRY_STEP_ID = 'entry';

// Leaves the run from any depth with a finished result. It never escapes replay.
class Stop {
  readonly result: ReplayResult;

  constructor(result: ReplayResult) {
    this.result = result;
  }
}

export async function replay(capability: Capability, supplied: Readonly<Record<string, unknown>>, context: ReplayContext): Promise<ReplayResult> {
  const { surface, control, clock, runId } = context;
  const allowedEnv = context.allowedEnv ?? [];
  const startedAt = clock.now().toISOString();
  const inputNames = Object.keys(supplied);
  const drift: DriftRecord[] = [];
  const outputs: Record<string, TypedValue> = {};
  const outputText: Record<string, string> = {};
  let stepsAttempted = 0;
  let stepsCompleted = 0;
  let currentStep: Step | null = null;

  const base = (): ResultBaseInput => ({
    runId,
    capability: { id: capability.id, version: capability.version },
    inputNames,
    startedAt,
    endedAt: clock.now().toISOString(),
    stepsAttempted,
    stepsCompleted,
    drift,
  });

  const fail = (detail: FailureInput): Stop =>
    new Stop(failureResult(base(), { atStepId: currentStep?.id ?? null, stepIntent: currentStep?.intent ?? null, ...detail }));

  // Inputs are checked before anything reaches the surface.
  const validated = validateInputs(capability.inputs, supplied);
  if (!validated.ok) {
    return failureResult(base(), {
      class: 'InputValidation',
      atStepId: null,
      stepIntent: null,
      expected: 'Inputs that satisfy the declared constraints.',
      observed: validated.problems.map((problem) => problem.message).join(' '),
      retryable: false,
    });
  }
  const inputText = Object.fromEntries(Object.entries(validated.values).map(([name, value]) => [name, String(value)]));
  const values = (): TemplateValues => ({ inputs: inputText, outputs: outputText, env: context.env ?? {} });
  const outputResolvable = async (name: string): Promise<boolean> => Object.hasOwn(outputs, name);

  // References are named in a failure, never their values.
  const templated = <T>(result: Templated<T>, where: string): T => {
    if (result.ok) return result.value;
    throw fail({
      class: 'Internal',
      expected: `Every template in ${where} resolves.`,
      observed: `Unresolved references: ${result.references.join(', ')}.`,
      retryable: false,
    });
  };

  const text = (source: string, where: string): string => {
    const resolution = resolveTemplate(source, values(), allowedEnv);
    return templated(resolution.ok ? { ok: true, value: resolution.text } : resolution, where);
  };

  const perform = async (prepared: PreparedAction, stepId: string, effect: 'read' | 'write', idempotent: boolean): Promise<void> => {
    const outcome = await surface.perform({ ...prepared, stepId, effect }, control);
    switch (outcome.kind) {
      case 'denied':
        throw fail({
          class: 'PolicyDenied',
          expected: 'An action the allowlist permits.',
          observed: outcome.decision.reason,
          cause: `rule ${outcome.decision.rule}`,
          retryable: false,
        });
      case 'confirm':
        throw fail({
          class: 'PolicyDenied',
          expected: 'An action that may run without a person approving it.',
          observed: 'This step writes to the system of record and no approval channel is attached to this run.',
          cause: `rule ${outcome.decision.rule}`,
          retryable: false,
        });
      case 'performed':
        if (!outcome.result.ok) throw fail(actionFailure(outcome.result, idempotent));
    }
  };

  // The network guard refuses a request the app profile does not allow for the running
  // step, before it reaches the server. Any refusal fails that step, whatever the page did.
  const failIfRefused = (stepId: string): void => {
    const refusals = surface.refusalsFor(stepId);
    const [first] = refusals;
    if (first === undefined) return;
    throw fail({
      class: 'PolicyDenied',
      expected: 'Every request the step makes is permitted by the allowlist and classified by the app profile as the step declares.',
      observed: `The network guard refused ${refusals.length} request(s) while this step ran.`,
      cause: `rule ${first.rule}`,
      retryable: false,
    });
  };

  const prepare = async (step: Step): Promise<PreparedAction> => {
    const stepAction = step.action;
    if (stepAction.kind === 'navigate') {
      const path = text(stepAction.path, `the path of ${step.id}`);
      return { action: { kind: 'navigate', path, framePath: stepAction.framePath }, framePath: stepAction.framePath, targetKey: null };
    }
    if (step.target === undefined) {
      throw fail({ class: 'Internal', expected: `Step ${step.id} has a target to act on.`, observed: 'The step has no target.', retryable: false });
    }

    const bundle = templated(templateBundle(step.target, values(), allowedEnv), `the target of ${step.id}`);
    const resolution = await surface.resolve(bundle, control);
    if (!resolution.ok) {
      throw fail({
        class: resolution.failure,
        expected: `${bundle.describedAs} resolves to exactly one element.`,
        observed:
          resolution.failure === 'LocatorAmbiguous'
            ? `Every strategy that matched ${bundle.describedAs} matched more than one element.`
            : `No strategy found ${bundle.describedAs}.`,
        locatorAttempts: resolution.attempts,
        retryable: false,
      });
    }
    if (resolution.drift !== null) drift.push(resolution.drift);

    const { ref } = resolution;
    const on = { framePath: bundle.framePath, targetKey: bundle.describedAs };
    switch (stepAction.kind) {
      case 'fill':
      case 'select':
        return { ...on, action: { kind: stepAction.kind, ref, value: text(step.value ?? '', `the value of ${step.id}`) } };
      case 'press':
        return { ...on, action: { kind: 'press', ref, key: stepAction.key } };
      case 'click':
      case 'hover':
      case 'scroll':
      case 'dismiss':
        return { ...on, action: { kind: stepAction.kind, ref } };
    }
  };

  const businessOutcome = (code: string): Stop => {
    const declared = capability.outcomes.find((outcome) => outcome.code === code);
    if (declared === undefined) {
      return fail({ class: 'Internal', expected: `Outcome ${code} is declared by the capability.`, observed: `Outcome ${code} fired but is not declared.`, retryable: false });
    }
    return new Stop(businessOutcomeResult(base(), { code: declared.code, description: declared.description, terminal: declared.terminal }));
  };

  const runStep = async (step: Step): Promise<void> => {
    if (step.precondition !== undefined) {
      const condition = templated(templateCondition(step.precondition.condition, values(), allowedEnv), `the precondition of ${step.id}`);
      const ready = await race(surface, clock, [{ condition, entrant: 'precondition' }], step.precondition.timeoutMs, outputResolvable);
      if (ready.kind !== 'fired') {
        const observed = ready.kind === 'expired' ? ready.lastDetail : 'The wait for the precondition stopped.';
        throw fail({ class: 'PreconditionFailed', expected: step.precondition.description, observed, retryable: false });
      }
    }

    // Observed before resolving, never between resolving and acting, so the ref check in
    // the driver still compares against the snapshot the ref came from.
    const before = fingerprint(await surface.observe());
    await perform(await prepare(step), step.id, step.effect, step.idempotent);

    // Precedence is one total order. Step rules, then capability outcomes, then the
    // postcondition. Within the step rules a business outcome goes first. The postcondition
    // is last, so an expired race explains the postcondition.
    const contenders: Contender<Entrant>[] = [
      ...[...step.onCondition]
        .sort((a, b) => Number(a.classify !== 'business_outcome') - Number(b.classify !== 'business_outcome'))
        .map((rule) => ({
          condition: templated(templateCondition(rule.when, values(), allowedEnv), `a condition rule of ${step.id}`),
          entrant: { kind: 'rule', code: rule.code, classify: rule.classify } as const,
        })),
      ...capability.outcomes.map((outcome) => ({
        condition: templated(templateCondition(outcome.detect, values(), allowedEnv), `outcome ${outcome.code}`),
        entrant: { kind: 'outcome', code: outcome.code } as const,
      })),
      {
        condition: templated(templateCondition(step.postcondition.condition, values(), allowedEnv), `the postcondition of ${step.id}`),
        entrant: { kind: 'postcondition' },
      },
    ];

    const timeoutMs = Math.min(step.postcondition.timeoutMs, step.timeoutMs);
    const settled = await race(surface, clock, contenders, timeoutMs, outputResolvable, () => surface.refusalsFor(step.id).length > 0);
    failIfRefused(step.id);
    if (settled.kind === 'stopped') {
      throw fail({ class: 'Internal', expected: 'The wait ends on a condition, a timeout or a refusal.', observed: 'The wait stopped with no refusal recorded.', retryable: false });
    }

    if (settled.kind === 'expired') {
      // Nothing changed at all is a wait that ran out. A change into the wrong state is a
      // checkpoint that failed. They have different fixes, so they are different classes.
      if (fingerprint(settled.observation) === before) {
        throw fail({
          class: 'Timeout',
          expected: step.postcondition.description,
          observed: `Timed out after ${timeoutMs}ms waiting for: ${step.postcondition.description}. The surface did not change after the action.`,
          retryable: step.idempotent,
        });
      }
      throw fail({ class: 'CheckpointFailed', expected: step.postcondition.description, observed: settled.lastDetail, retryable: false });
    }

    const { entrant } = settled;
    if (entrant.kind === 'outcome' || (entrant.kind === 'rule' && entrant.classify === 'business_outcome')) {
      throw businessOutcome(entrant.code);
    }
    if (entrant.kind === 'rule') {
      throw fail({
        class: 'Internal',
        expected: `A handler for the ${entrant.classify} classification of ${entrant.code}.`,
        observed: `The condition ${entrant.code} fired and asks for ${entrant.classify}, which no handler in this executor covers.`,
        retryable: false,
      });
    }

    for (const spec of capability.outputs.filter((output) => output.source.stepId === step.id)) {
      const target = templated(templateBundle(spec.source.target, values(), allowedEnv), `the source of output ${spec.name}`);
      const extraction = await extractOutput(spec, target, settled.observation, surface);
      if (extraction.ok) {
        outputs[spec.name] = extraction.value;
        outputText[spec.name] = extraction.text;
      } else if (spec.required) {
        throw fail({ class: 'OutputUnresolvable', expected: `${spec.name} can be read from ${target.describedAs}.`, observed: extraction.reason, retryable: false });
      }
    }
  };

  try {
    await perform({ action: { kind: 'navigate', path: capability.app.entryPath, framePath: [] }, framePath: [], targetKey: null }, ENTRY_STEP_ID, 'read', true);
    failIfRefused(ENTRY_STEP_ID);

    for (const step of capability.steps) {
      currentStep = step;
      stepsAttempted += 1;
      await runStep(step);
      stepsCompleted += 1;
    }

    const success = capability.successCondition;
    const condition = templated(templateCondition(success.condition, values(), allowedEnv), 'the success condition');
    const done = await race(surface, clock, [{ condition, entrant: 'success' }], success.timeoutMs, outputResolvable);
    if (done.kind !== 'fired') {
      const observed = done.kind === 'expired' ? done.lastDetail : 'The wait for the success condition stopped.';
      throw fail({ class: 'CheckpointFailed', stepIntent: success.description, expected: success.description, observed, retryable: false });
    }
    return successResult(base(), outputs);
  } catch (error) {
    if (error instanceof Stop) return error.result;
    const at = { atStepId: currentStep?.id ?? null, stepIntent: currentStep?.intent ?? null };
    if (error instanceof ControlLostError) {
      return failureResult(base(), {
        ...at,
        class: 'ControlLost',
        expected: 'Automation holds control of the session.',
        observed: 'Control of the session moved to another holder before the action.',
        retryable: false,
      });
    }
    return failureResult(base(), {
      ...at,
      class: 'Internal',
      expected: 'The run completes without an unexpected error.',
      observed: 'An unexpected error stopped the run.',
      cause: error instanceof Error ? error.name : 'unknown',
      retryable: false,
    });
  }
}

function actionFailure(result: Extract<ActionResult, { ok: false }>, idempotent: boolean): FailureInput {
  switch (result.reason) {
    case 'not_found':
      return { class: 'LocatorNotFound', expected: 'The resolved element is still there to act on.', observed: result.detail, retryable: idempotent };
    case 'disabled':
      return { class: 'PreconditionFailed', expected: 'An enabled element to act on.', observed: result.detail, retryable: false };
    case 'not_actionable':
      return { class: 'Timeout', expected: 'The element accepts the action within the action timeout.', observed: result.detail, retryable: idempotent };
    case 'navigation_failed':
      return { class: 'SurfaceUnavailable', expected: 'The navigation completes.', observed: result.detail, retryable: idempotent };
  }
}

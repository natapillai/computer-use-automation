import { ControlLostError, type ControlToken } from '../control/controlToken.js';
import { validateInputs } from '../core/capability/inputs.js';
import { resolveTemplate, type TemplateValues } from '../core/capability/resolveTemplate.js';
import type { Capability, OutputSpec, Step } from '../core/capability/schema.js';
import { templateBundle, templateCondition, type Templated } from '../core/capability/templateCondition.js';
import type { DriftRecord } from '../core/locator/resolve.js';
import type { AppProfile } from '../core/policy/profile.js';
import {
  businessOutcomeResult,
  escalatedResult,
  FAILURE_CLASSES,
  failureResult,
  successResult,
  type EscalationReason,
  type FailureClass,
  type FailureDetail,
  type InterventionRecord,
  type ReplayResult,
  type RecoveryRecord,
  type ResultBaseInput,
  type TypedValue,
} from '../core/outcome/result.js';
import type { GrantLedger } from '../core/policy/authorize.js';
import type { EscalationChannel } from '../escalation/channel.js';
import { unclassifiedDialog } from '../escalation/unclassified.js';
import { revalidate, type Resumption } from './resume.js';
import { fingerprint } from '../core/surfaceModel/fingerprint.js';
import type { ActionResult, Observation, ResolvedAction } from '../core/surfaceModel/types.js';
import type { Clock } from '../runtime/clock.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';
import { extractOutput } from './extract.js';
import { race, type Contender, type RaceOutcome } from './race.js';

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
  readonly profile: AppProfile;
  readonly env?: Readonly<Record<string, string>>;
  readonly allowedEnv?: readonly string[];
  // Where the run stops for a person. Without it a step that needs approval fails, because
  // nothing can approve it, see docs/ESCALATION.md section 5.
  readonly escalation?: EscalationChannel;
  // The same ledger the guarded surface authorizes against, so an approval a person gave can
  // be spent on exactly one action.
  readonly grants?: GrantLedger;
  // Refs for the screenshot and snapshot an intervention carries, written by the caller.
  readonly capture?: () => Promise<{ readonly screenshotRef: string; readonly snapshotRef: string }>;
}

type RuleClass = Step['onCondition'][number]['classify'];

type Entrant =
  | { readonly kind: 'rule'; readonly code: string; readonly classify: RuleClass }
  | { readonly kind: 'outcome'; readonly code: string }
  | { readonly kind: 'profile'; readonly code: string; readonly classify: AppProfile['conditions'][number]['classify'] }
  | { readonly kind: 'postcondition' };

type FailureInput = Omit<FailureDetail, 'atStepId' | 'stepIntent'> & Partial<Pick<FailureDetail, 'stepIntent'>>;

interface PreparedAction {
  readonly action: ResolvedAction;
  readonly framePath: readonly string[];
  readonly targetKey: string | null;
}

// The entry point is not a step, so it has no step id of its own to bind a grant to.
const ENTRY_STEP_ID = 'entry';

// A handoff that keeps coming back on the same step is a loop, not an escalation.
const MAX_HANDOVERS_PER_STEP = 3;

// A transient load is routine on this surface. Three attempts with a doubling backoff, and
// only on a step that declares itself idempotent, because repeating a submit risks a double
// post. The wait is spent on Clock.delay so no test has to wait for it.
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_BACKOFF_MS = 500;

// Leaves the run from any depth with a finished result. It never escapes replay.
class Stop {
  readonly result: ReplayResult;

  constructor(result: ReplayResult) {
    this.result = result;
  }
}

export async function replay(capability: Capability, supplied: Readonly<Record<string, unknown>>, context: ReplayContext): Promise<ReplayResult> {
  const { surface, clock, runId } = context;
  // Replaced on every resume. The token the run started with dies the moment a person claims
  // the session, so acting with it afterwards is exactly what ADR 0008 forbids.
  let control = context.control;
  const interventions: InterventionRecord[] = [];
  const recoveries: RecoveryRecord[] = [];
  let handoversOnStep = 0;
  const allowedEnv = context.allowedEnv ?? [];
  const startedAt = clock.now().toISOString();
  const startedAtMs = clock.now().getTime();
  // Time a person held the session. The duration budget bounds the automation, not somebody
  // reading a screen and deciding, so a handover that outlasts the budget must not fail the run
  // the moment it comes back. Discovery does the same.
  let pausedMs = 0;
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
    interventions,
    recoveries,
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

  const perform = async (prepared: PreparedAction, stepId: string, effect: 'read' | 'write', idempotent: boolean, afterApproval = false): Promise<void> => {
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
      case 'confirm': {
        if (context.escalation === undefined) {
          throw fail({
            class: 'PolicyDenied',
            expected: 'An action that may run without a person approving it.',
            observed: 'This step writes to the system of record and no approval channel is attached to this run.',
            cause: `rule ${outcome.decision.rule}`,
            retryable: false,
          });
        }
        if (afterApproval) {
          throw fail({
            class: 'PolicyDenied',
            expected: 'The approved action runs once, spending the grant the person gave.',
            observed: 'The step asked for approval again after one was already given.',
            cause: `rule ${outcome.decision.rule}`,
            retryable: false,
          });
        }
        const resumption = await handOver(
          'PolicyConfirmation',
          `This step writes to the system of record, so it needs a person to approve it. ${outcome.decision.reason}`,
          'Approve the action if it is the right thing to do, or do it yourself and hand the session back.',
        );
        await resume(resumption, prepared, stepId, effect, idempotent);
        return;
      }
      case 'performed':
        if (!outcome.result.ok) throw fail(actionFailure(outcome.result, idempotent));
    }
  };

  // Everything an intervention needs, raised, waited on, and recorded whichever way it ends.
  const handOver = async (reason: EscalationReason, explanation: string, suggestedAction: string): Promise<Resumption> => {
    const channel = context.escalation;
    if (channel === undefined) return { kind: 'escalate', detail: 'No approval channel is attached to this run.' };

    handoversOnStep += 1;
    const step = currentStep;
    const startedAt = clock.now().toISOString();
    const pausedAt = clock.now().getTime();
    const refs = (await context.capture?.()) ?? { screenshotRef: 'none', snapshotRef: 'none' };
    const before = await surface.observe();
    const handover = await channel.raise({
      sessionId: surface.sessionId,
      runId,
      phase: 'replay',
      reason,
      explanation,
      suggestedAction,
      capability: { id: capability.id, version: capability.version },
      ...(step === null ? {} : { atStep: { id: step.id, index: step.index, intent: step.intent } }),
      url: before.frames[0]?.url ?? '',
      framePath: step?.action.kind === 'navigate' ? step.action.framePath : (step?.target?.framePath ?? []),
      screenshotRef: refs.screenshotRef,
      snapshotRef: refs.snapshotRef,
      recentActions: [],
    });

    pausedMs += clock.now().getTime() - pausedAt;
    interventions.push({
      interventionId: handover.interventionId,
      reason,
      atStepId: step?.id ?? null,
      disposition: handover.kind === 'resumed' ? 'resumed' : handover.kind,
      startedAt,
      endedAt: clock.now().toISOString(),
    });

    if (handover.kind !== 'resumed') {
      throw new Stop(escalatedResult(base(), { id: handover.interventionId, reason, atStepId: step?.id ?? null, disposition: handover.kind }));
    }
    control = handover.token;
    if (step === null) return { kind: 'escalate', detail: 'The run had no step to revalidate after the release.' };

    // The page may be somewhere else entirely now, which is the whole point of the person
    // having been there, so nothing resumes until a fresh observation says what is true.
    const after = await surface.observe();
    return revalidate({
      capability,
      step,
      observation: after,
      match: (strategy, framePath) => surface.match(strategy, framePath),
      // Here an output is resolvable when the page can be read for it now, not when the run
      // happens to have extracted it already. A person who finished the task left the answer on
      // the screen, and asking the wrong question would miss exactly that.
      outputResolvable: async (name) => {
        const spec = capability.outputs.find((candidate) => candidate.name === name);
        if (spec === undefined) return false;
        const target = templated(templateBundle(spec.source.target, values(), allowedEnv), `the source of output ${name}`);
        return (await extractOutput(spec, target, after, surface)).ok;
      },
      values: values(),
      allowedEnv,
      approved: handover.approved,
    });
  };

  const resume = async (resumption: Resumption, prepared: PreparedAction, stepId: string, effect: 'read' | 'write', idempotent: boolean): Promise<void> => {
    switch (resumption.kind) {
      case 'success': {
        // An operator asked to unblock a two step problem often just finishes the task.
        await collectOutputs(await surface.observe(), capability.outputs);
        throw new Stop(successResult(base(), outputs));
      }
      case 'outcome':
        throw businessOutcome(resumption.code);
      case 'satisfiedByHuman':
        return;
      case 'approved':
        // One action, approved once. The ledger hands it out and the policy spends it.
        context.grants?.issue({ runId, stepId, targetKey: prepared.targetKey });
        await perform(prepared, stepId, effect, idempotent, true);
        return;
      case 'retry':
        await perform(prepared, stepId, effect, idempotent);
        return;
      case 'escalate': {
        // The person is already engaged, so telling them it is still not right is more use
        // than ending the run and making them start over. Bounded, because a handoff that
        // keeps coming back is a loop rather than an escalation.
        if (handoversOnStep >= MAX_HANDOVERS_PER_STEP) {
          // Not PolicyDenied. Nothing refused this run. People looked at it three times and
          // the step still has nothing to run against, which is a precondition that does not
          // hold. Calling it a refusal would send whoever reads the result to the allowlist.
          throw fail({
            class: 'PreconditionFailed',
            expected: 'The release leaves the run somewhere it can carry on from.',
            observed: `Handed back three times on this step and it is still not somewhere the run can carry on from. ${resumption.detail}`,
            retryable: false,
          });
        }
        const again = await handOver(
          'resumePreconditionFailed',
          `The session came back, and the run still cannot carry on. ${resumption.detail}`,
          'Put the session where this step can run, or end the run.',
        );
        await resume(again, prepared, stepId, effect, idempotent);
        return;
      }
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

  // Whether this is a moment a person has to look at, and what to tell them when it is.
  const personNeededFor = async (
    outcome: RaceOutcome<Entrant>,
    contenders: readonly Contender<Entrant>[],
  ): Promise<{ readonly reason: EscalationReason; readonly explanation: string; readonly suggestedAction: string } | null> => {
    if (context.escalation === undefined) return null;

    if (outcome.kind === 'expired') {
      if (!outcome.observation.dialogOpen) return null;
      const unclaimed = await unclassifiedDialog({
        observation: outcome.observation,
        conditions: contenders.map((contender) => contender.condition),
        match: (strategy, framePath) => surface.match(strategy, framePath),
        outputResolvable,
      });
      return unclaimed
        ? {
            reason: 'UnclassifiedCondition',
            explanation: 'A dialog is open that nothing in this capability or the app profile claims, so the run stopped rather than clicking it.',
            suggestedAction: 'Deal with the dialog, leave the session where this step can carry on, and hand it back.',
          }
        : null;
    }
    if (outcome.kind !== 'fired') return null;

    const entrant = outcome.entrant;
    if ((entrant.kind !== 'rule' && entrant.kind !== 'profile') || entrant.classify !== 'escalate') return null;
    return {
      reason: 'RuleRequested',
      explanation: `The ${entrant.kind === 'rule' ? 'step' : 'app profile'} condition ${entrant.code} says a person should decide what happens next.`,
      suggestedAction: 'Look at what the screen is showing, deal with it, and hand the session back.',
    };
  };

  const collectOutputs = async (observation: Observation, specs: readonly OutputSpec[]): Promise<void> => {
    for (const spec of specs) {
      const target = templated(templateBundle(spec.source.target, values(), allowedEnv), `the source of output ${spec.name}`);
      const extraction = await extractOutput(spec, target, observation, surface);
      if (extraction.ok) {
        outputs[spec.name] = extraction.value;
        outputText[spec.name] = extraction.text;
      } else if (spec.required) {
        throw fail({ class: 'OutputUnresolvable', expected: `${spec.name} can be read from ${target.describedAs}.`, observed: extraction.reason, retryable: false });
      }
    }
  };

  const businessOutcome = (code: string): Stop => {
    const declared = capability.outcomes.find((outcome) => outcome.code === code);
    if (declared === undefined) {
      return fail({ class: 'Internal', expected: `Outcome ${code} is declared by the capability.`, observed: `Outcome ${code} fired but is not declared.`, retryable: false });
    }
    return new Stop(businessOutcomeResult(base(), { code: declared.code, description: declared.description, terminal: declared.terminal }));
  };

  // Asking for a response again. A frame is sent to the url it is already on, which goes
  // through authorize like any other navigation, so a recovery cannot reach somewhere the
  // allowlist would refuse.
  const reloadFrame = async (framePath: readonly string[], stepId: string): Promise<void> => {
    const observation = await surface.observe();
    const frame = observation.frames.find((candidate) => candidate.framePath.join('/') === framePath.join('/'));
    if (frame === undefined) return;
    // The path rather than the whole url, because that is how every other navigation in a
    // capability is expressed and it is what the allowlist reads.
    let path: string;
    try {
      const parsed = new URL(frame.url);
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      return;
    }
    await perform({ action: { kind: 'navigate', path, framePath }, framePath, targetKey: null }, stepId, 'read', true);
  };

  const attemptStep = async (step: Step): Promise<void> => {
    handoversOnStep = 0;
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
    const prepared = await prepare(step);
    await perform(prepared, step.id, step.effect, step.idempotent);

    // Precedence is one total order, docs/ERROR_TAXONOMY.md section 6. Step rules, then
    // capability outcomes, then the app profile, then the postcondition. Within the step
    // rules a business outcome goes first. The profile sits above the postcondition, so a
    // login page that happens to satisfy a postcondition still reads as SessionExpired. The
    // postcondition is last, so an expired race explains the postcondition.
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
      ...context.profile.conditions.map((condition) => ({
        condition: templated(templateCondition(condition.when, values(), allowedEnv), `the app profile condition ${condition.code}`),
        entrant: { kind: 'profile', code: condition.code, classify: condition.classify } as const,
      })),
      {
        condition: templated(templateCondition(step.postcondition.condition, values(), allowedEnv), `the postcondition of ${step.id}`),
        entrant: { kind: 'postcondition' },
      },
    ];

    const timeoutMs = Math.min(step.postcondition.timeoutMs, step.timeoutMs);
    const stopWhenRefused = (): boolean => surface.refusalsFor(step.id).length > 0;
    let settled = await race(surface, clock, contenders, timeoutMs, outputResolvable, stopWhenRefused);

    // Two things stop a step for a person. A dialog nobody declared, which is the case where the
    // system does not know what to do next, and a rule that says a person should decide. Either
    // way the step only counts afterwards when its own postcondition holds, so the wait runs
    // again on whatever page they left behind. One handoff per step here, and handOver bounds
    // the handing back that follows.
    for (let handoffs = 0; handoffs < 2; handoffs += 1) {
      failIfRefused(step.id);
      if (settled.kind === 'stopped') {
        throw fail({ class: 'Internal', expected: 'The wait ends on a condition, a timeout or a refusal.', observed: 'The wait stopped with no refusal recorded.', retryable: false });
      }

      const needsPerson = await personNeededFor(settled, contenders);
      if (needsPerson === null) break;

      const resumption = await handOver(needsPerson.reason, needsPerson.explanation, needsPerson.suggestedAction);
      await resume(resumption, prepared, step.id, step.effect, step.idempotent);
      settled = await race(surface, clock, contenders, timeoutMs, outputResolvable, stopWhenRefused);
    }

    // The last wait of the loop is checked here, which is also what stops the run from reading a
    // refusal as an ordinary timeout.
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
    // A transient load is a response that failed, so the recovery is to ask for that response
    // again. Repeating the action would be wrong here. An action that navigates cannot be
    // repeated from the page it landed on, because the thing it acted on is no longer there.
    if ((entrant.kind === 'rule' || entrant.kind === 'profile') && entrant.classify === 'recoverable') {
      if (!step.idempotent) {
        throw fail({
          class: 'SurfaceUnavailable',
          expected: step.postcondition.description,
          observed: `The condition ${entrant.code} holds, and this step is not idempotent, so nothing was retried.`,
          retryable: true,
        });
      }
      const retried: number[] = [];
      for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
        if (attempt === MAX_RECOVERY_ATTEMPTS) {
          for (const number of [...retried, attempt]) recoveries.push({ condition: 'TransientLoad', atStepId: step.id, attempt: number, resolved: false });
          throw fail({
            class: 'SurfaceUnavailable',
            expected: step.postcondition.description,
            observed: `The condition ${entrant.code} held on all ${MAX_RECOVERY_ATTEMPTS} attempts at this step.`,
            retryable: true,
          });
        }
        retried.push(attempt);
        await clock.delay(RECOVERY_BACKOFF_MS * 2 ** (attempt - 1));
        await reloadFrame(prepared.framePath, step.id);
        settled = await race(surface, clock, contenders, timeoutMs, outputResolvable, stopWhenRefused);
        failIfRefused(step.id);
        const still = settled.kind === 'fired' && (settled.entrant.kind === 'rule' || settled.entrant.kind === 'profile') && settled.entrant.classify === 'recoverable';
        if (still) continue;
        // Reported even though the run worked. A capability that only succeeds once the
        // surface is asked twice is a fact about the surface worth having in the result.
        for (const number of retried) recoveries.push({ condition: 'TransientLoad', atStepId: step.id, attempt: number, resolved: true });
        break;
      }
      if (settled.kind !== 'fired') {
        throw fail({ class: 'CheckpointFailed', expected: step.postcondition.description, observed: 'The step did not reach its postcondition after the surface recovered.', retryable: false });
      }
      if (settled.entrant.kind === 'outcome' || (settled.entrant.kind === 'rule' && settled.entrant.classify === 'business_outcome')) {
        throw businessOutcome(settled.entrant.code);
      }
    }
    const decided = settled.kind === 'fired' ? settled.entrant : entrant;
    if (decided.kind === 'rule' || decided.kind === 'profile') {
      const layer = decided.kind === 'rule' ? 'step' : 'app profile';
      // A failure named by a known class is that class. Anything else that fired has no
      // handler yet, recovery at S6-T02 and escalation at S5, and fails as our own gap.
      if (decided.classify === 'failure' && isFailureClass(decided.code)) {
        throw fail({
          class: decided.code,
          expected: step.postcondition.description,
          observed: `The ${layer} condition ${decided.code} holds.`,
          retryable: decided.code === 'SurfaceUnavailable' && step.idempotent,
        });
      }
      // Reached only when the recovery above ran out of ways to help.
      if (decided.classify === 'recoverable') {
        // Reached only when the recovery above ran out of ways to help, because a recoverable
        // condition that still holds after the retries is not recoverable on this run.
        throw fail({
          class: 'SurfaceUnavailable',
          expected: step.postcondition.description,
          observed: `The ${layer} condition ${decided.code} still holds.`,
          retryable: true,
        });
      }

      throw fail({
        class: 'Internal',
        expected: `A handler for the ${decided.classify} classification of ${decided.code}.`,
        observed: `The ${layer} condition ${decided.code} fired and asks for ${decided.classify}, which no handler in this executor covers.`,
        retryable: false,
      });
    }

    await collectOutputs(
      settled.observation,
      capability.outputs.filter((output) => output.source.stepId === step.id),
    );
  };

  const runStep = async (step: Step): Promise<void> => {
    // The budget bounds how long the automation runs, not how long a person takes to answer,
    // so the time somebody held the session is taken off before the comparison.
    const spent = clock.now().getTime() - startedAtMs - pausedMs;
    if (spent > capability.policy.maxTotalDurationMs) {
      throw fail({
        class: 'Timeout',
        expected: `The run finishes within the ${capability.policy.maxTotalDurationMs}ms this capability allows.`,
        observed: `The run had spent ${spent}ms before ${step.id}, not counting any time a person held the session.`,
        retryable: true,
      });
    }

    await attemptStep(step);
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

function isFailureClass(code: string): code is FailureClass {
  return FAILURE_CLASSES.some((failureClass) => failureClass === code);
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

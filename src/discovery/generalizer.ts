import type { z } from 'zod';
import { Capability, SUPPORTED_SCHEMA_VERSION, type CapabilityInput, type ParamSpec } from '../core/capability/schema.js';
import { findSensitiveLiterals, wholeTokenPattern } from '../core/capability/sensitiveLiterals.js';
import { templateBundle, templateCondition } from '../core/capability/templateCondition.js';
import { resolveBundle, type StrategyMatcher } from '../core/locator/resolve.js';
import type { LocatorBundle, LocatorStrategy } from '../core/locator/schema.js';
import type { ConditionMatcher } from '../core/outcome/condition.js';
import { evaluateCondition } from '../core/outcome/evaluate.js';
import { parseMoney } from '../core/outcome/money.js';
import { sensitiveFields, type AppProfile } from '../core/policy/profile.js';
import type { Redactor } from '../core/redaction/redactor.js';
import { matchStrategy } from '../core/surfaceModel/match.js';
import { findNodeByRef } from '../core/surfaceModel/tree.js';
import type { Observation } from '../core/surfaceModel/types.js';
import type { RecordedAction } from './recorder.js';
import type { RunTrace } from './trace.js';

// A pure function from a run trace to a draft capability, see docs/ARCHITECTURE.md section 6.
// Five transforms. Prune, parameterise, canonicalise, infer checkpoints, type outputs. The
// model calling done is not success. The success condition is synthesized from the outputs
// and re asserted against the observation the run ended on, which catches a model declaring
// victory on the wrong screen.

export const GENERALIZER_VERSION = '1.0.0';
export const RECORDER_VERSION = '1.0.0';
export const PROMPT_VERSION = '1.0.0';

export type ParamSpecInput = z.input<typeof ParamSpec>;

export interface GeneralizeOptions {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly app: { readonly appId: string; readonly vendor: string; readonly entryPath: string };
  readonly inputs: readonly ParamSpecInput[];
  readonly inputValues: Readonly<Record<string, string>>;
  readonly recordedAt: string;
  readonly model: string;
  readonly profile: AppProfile;
  readonly redactor: Redactor;
}

export type Generalization =
  | { readonly ok: true; readonly capability: Capability }
  | {
      readonly ok: false;
      readonly failure: 'NoSteps' | 'NoPostcondition' | 'SuccessNotObserved' | 'SensitiveLiteral' | 'CapabilityInvalid' | 'HumanCompleted';
      readonly detail: string;
    };

type StepInput = CapabilityInput['steps'][number];
type OutputInput = CapabilityInput['outputs'][number];
interface CheckpointDraft {
  readonly description: string;
  readonly condition: ConditionMatcher;
  readonly timeoutMs: number;
}
type Failure = Extract<Generalization, { ok: false }>;

const fail = (failure: Failure['failure'], detail: string): Failure => ({ ok: false, failure, detail });

// Async only because condition evaluation and locator resolution are async in core. It reads
// the trace and nothing else, no surface, no model, no clock.
export async function generalize(trace: RunTrace, options: GeneralizeOptions): Promise<Generalization> {
  const template = (text: string): string => templateInputs(text, options.inputValues);

  // 0. Refuse a run a person had to finish, per docs/ESCALATION.md section 8. Nothing here
  // turns what they did into a step, so the artifact would claim the automation can do
  // something it has never done unaided. Approving one action is not finishing the run, and a
  // write capability exists only because a person approved its submit.
  const completedByHand = trace.events.find((event) => event.t === 'handback' && event.reason !== 'PolicyConfirmation');
  if (completedByHand !== undefined) {
    return fail('HumanCompleted', 'A person took the session over during this run, and their actions are not steps, so no artifact is produced.');
  }

  // 1. Prune. A failed attempt or an action that changed nothing is not part of the flow. An
  // extract changes nothing by design and is kept, because it types an output.
  const pruned = trace.actions.filter((action) => action.ok === true && (action.changed === true || action.tool === 'extract'));

  // 2. Parameterise, input values in step values and locator text become templates.
  // 3. Canonicalise, input values inside navigate paths become templates, so a recorded
  // /member/10001 never replays for another member against the wrong record.
  const actions = pruned.map((action) => canonicalise(parameterise(action, template), template));

  const acting = actions.filter((action) => action.tool !== 'extract');
  if (acting.length === 0) return fail('NoSteps', 'The run recorded no action that worked and changed the page.');
  const unreplayable = acting.find((action) => action.tool !== 'navigate' && action.bundle === null);
  if (unreplayable !== undefined) return fail('NoSteps', `A ${unreplayable.tool} that worked has no locator that uniquely found its element.`);

  const ids = new Set<string>();
  const stepIds = new Map<RecordedAction, string>();
  for (const action of acting) stepIds.set(action, uniqueId(idWords(action), ids));

  // 5. Type outputs, each extract becomes an output read after the last step before it.
  const outputs: OutputInput[] = [];
  const sensitive = sensitiveFields(options.profile, trace.finalObservation);
  for (const extract of actions.filter((action) => action.tool === 'extract')) {
    const name = extract.output;
    const bundle = extract.bundle;
    const before = acting.filter((action) => action.index < extract.index).at(-1);
    if (name === undefined || bundle === null || before === undefined) continue;
    const text = trace.extracted[name]?.text ?? '';
    const parse = parseRuleFor(text);
    const ref = await refOn(trace.finalObservation, bundle, options.inputValues);
    const cellLevel = ref === null ? undefined : sensitive.get(ref);
    outputs.push({
      name,
      type: parse === undefined ? 'string' : parse.kind,
      description: `The value read from ${plain(bundle.describedAs)}`,
      sensitivity: parse?.kind === 'money' ? 'pii' : (cellLevel ?? 'internal'),
      required: true,
      source: { stepId: stepIds.get(before) ?? '', target: bundle, attribute: 'text', ...(parse === undefined ? {} : { parse }) },
    });
  }

  // 4. Infer checkpoints. A fill checks its own field holds the input. Every other step checks
  // that the element the next step or output needs is present, which is the observation that
  // followed it. Never a url alone, because in a frameset the url often does not change.
  const steps: StepInput[] = [];
  const postconditions: CheckpointDraft[] = [];
  for (const [position, action] of acting.entries()) {
    const postcondition = postconditionFor(action, actions, outputs);
    if (postcondition === null) return fail('NoPostcondition', `Nothing observed after the ${action.tool} at position ${position} can confirm it worked.`);
    postconditions.push(postcondition);
    // A write is one the model declared. Nothing about a click says whether the button behind
    // it submits, so guessing here would either retry a post or refuse to retry anything.
    const effect = action.submits ? 'write' : 'read';
    const idempotent = !action.submits && (action.tool === 'fill' || action.tool === 'select' || action.tool === 'navigate');
    steps.push({
      id: stepIds.get(action) ?? '',
      index: position,
      intent: intentFor(action),
      action: actionFor(action),
      ...(action.bundle === null ? {} : { target: action.bundle }),
      ...(action.value === undefined ? {} : { value: action.value }),
      postcondition,
      effect,
      idempotent,
      retry: idempotent ? { attempts: 2, backoffMs: 500 } : { attempts: 0 },
      timeoutMs: 15_000,
      provenance: 'model',
    });
  }

  const successCondition = synthesizeSuccess(outputs, postconditions);
  if (!(await holdsOn(successCondition.condition, trace.finalObservation, outputs, options.inputValues))) {
    return fail('SuccessNotObserved', 'The synthesized success condition does not hold on the observation the run ended on.');
  }

  const candidate: CapabilityInput = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    id: options.id,
    version: '1.0.0',
    name: options.name,
    description: options.description,
    app: options.app,
    surface: { kind: 'legacy-web', minDriverVersion: '1.0.0', capabilitiesRequired: actions.some((action) => action.framePath.length > 0) ? ['frames'] : [] },
    inputs: [...options.inputs],
    outputs,
    outcomes: [],
    steps,
    successCondition,
    // The ceiling is what the run actually did, so a read only capability can never grow a
    // write later without the artifact itself changing and being reviewed again.
    policy: {
      maxEffect: steps.some((step) => step.effect === 'write') ? 'write' : 'read',
      requiresApproval: true,
      allowUnattendedReplay: false,
      maxStepDurationMs: 20_000,
      maxTotalDurationMs: 120_000,
    },
    provenance: {
      recordedAt: options.recordedAt,
      discoveryRunId: trace.runId,
      model: options.model,
      promptVersion: PROMPT_VERSION,
      recorderVersion: RECORDER_VERSION,
      generalizerVersion: GENERALIZER_VERSION,
      redactionApplied: true,
    },
    lifecycle: { status: 'draft' },
  };

  // Never emit a sensitive literal. A supplied value that survived templating, or anything
  // the redactor would catch, refuses the artifact. The capability store scans again.
  const leaks = findSensitiveLiterals(JSON.stringify(candidate), { inputs: options.inputs, inputValues: options.inputValues, redactor: options.redactor });
  if (leaks.length > 0) return fail('SensitiveLiteral', `The artifact carries ${leaks.join(', ')}.`);

  const parsed = Capability.safeParse(candidate);
  if (!parsed.success) {
    return fail('CapabilityInvalid', parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('. '));
  }
  return { ok: true, capability: parsed.data };
}

function parameterise(action: RecordedAction, template: (text: string) => string): RecordedAction {
  return {
    ...action,
    ...(action.value === undefined ? {} : { value: template(action.value) }),
    bundle: action.bundle === null ? null : mapBundle(action.bundle, template),
  };
}

function canonicalise(action: RecordedAction, template: (text: string) => string): RecordedAction {
  return action.path === undefined ? action : { ...action, path: template(action.path) };
}

function postconditionFor(action: RecordedAction, actions: readonly RecordedAction[], outputs: readonly OutputInput[]): CheckpointDraft | null {
  if ((action.tool === 'fill' || action.tool === 'select') && action.bundle !== null && action.value !== undefined) {
    return {
      description: `${plain(action.bundle.describedAs)} holds ${plain(action.value)}`,
      condition: { kind: 'textMatches', target: action.bundle, pattern: `^${action.value}$` },
      timeoutMs: 10_000,
    };
  }
  const next = actions.find((candidate) => candidate.index > action.index && candidate.bundle !== null);
  const target = next?.bundle ?? outputs[0]?.source.target ?? null;
  if (target === null) return null;
  return { description: `${plain(target.describedAs)} is present`, condition: { kind: 'elementPresent', target }, timeoutMs: 10_000 };
}

function synthesizeSuccess(outputs: readonly OutputInput[], postconditions: readonly CheckpointDraft[]): { readonly description: string; readonly condition: ConditionMatcher } {
  if (outputs.length > 0) {
    const of: ConditionMatcher[] = [
      ...outputs.map((output): ConditionMatcher => ({ kind: 'elementPresent', target: output.source.target })),
      ...outputs.map((output): ConditionMatcher => ({ kind: 'outputResolvable', outputName: output.name })),
    ];
    return { description: `The run ends with ${outputs.map((output) => output.name).join(' and ')} readable`, condition: { kind: 'all', of } };
  }
  const last = postconditions.at(-1);
  return { description: 'The final screen of the run is present', condition: { kind: 'all', of: last === undefined ? [] : [last.condition] } };
}

async function holdsOn(condition: ConditionMatcher, observation: Observation, outputs: readonly OutputInput[], inputValues: Readonly<Record<string, string>>): Promise<boolean> {
  const templated = templateCondition(condition, { inputs: inputValues, outputs: {}, env: {} }, []);
  if (!templated.ok) return false;
  const evaluation = await evaluateCondition(templated.value, {
    observation,
    match: matcherFor(observation),
    outputResolvable: async (name) => {
      const output = outputs.find((candidate) => candidate.name === name);
      if (output === undefined) return false;
      const ref = await refOn(observation, output.source.target, inputValues);
      const node = ref === null ? null : findNodeByRef(observation.root, ref);
      if (node === null) return false;
      const text = node.value ?? node.name;
      return output.source.parse?.kind === 'money' ? parseMoney(text, output.source.parse.currency).ok : text.trim() !== '';
    },
  });
  return evaluation.holds;
}

async function refOn(observation: Observation, bundle: LocatorBundle, inputValues: Readonly<Record<string, string>>): Promise<string | null> {
  const templated = templateBundle(bundle, { inputs: inputValues, outputs: {}, env: {} }, []);
  if (!templated.ok) return null;
  const resolution = await resolveBundle(templated.value, matcherFor(observation));
  return resolution.ok ? resolution.ref : null;
}

function matcherFor(observation: Observation): StrategyMatcher {
  return async (strategy, framePath) => matchStrategy(observation, strategy, framePath);
}

// Money when the text says what currency it is, a number when it is only digits, otherwise text.
function parseRuleFor(text: string): { readonly kind: 'money'; readonly currency: string } | { readonly kind: 'number' } | undefined {
  const trimmed = text.trim();
  const code = /\b([A-Z]{3})\s*$/.exec(trimmed)?.[1];
  const currency = trimmed.includes('$') ? 'USD' : code;
  if (currency !== undefined && parseMoney(trimmed, currency).ok) return { kind: 'money', currency };
  if (/^-?[\d,]+(\.\d+)?$/.test(trimmed)) return { kind: 'number' };
  return undefined;
}

function actionFor(action: RecordedAction): StepInput['action'] {
  switch (action.tool) {
    case 'navigate':
      return { kind: 'navigate', path: action.path ?? '/', framePath: [...action.framePath] };
    case 'press':
      return { kind: 'press', key: action.key ?? 'Enter' };
    case 'fill':
      return { kind: 'fill' };
    case 'select':
      return { kind: 'select' };
    case 'click':
    case 'extract':
      return { kind: 'click' };
  }
}

function intentFor(action: RecordedAction): string {
  const described = plain(action.bundle?.describedAs ?? '');
  switch (action.tool) {
    case 'navigate':
      return `Open ${plain(action.path ?? '/')} in the ${action.framePath.length === 0 ? 'top' : action.framePath.join(' > ')} frame`;
    case 'fill':
      return `Enter ${plain(action.value ?? '')} into ${described}`;
    case 'select':
      return `Choose ${plain(action.value ?? '')} in ${described}`;
    case 'press':
      return `Press ${action.key ?? 'Enter'} on ${described}`;
    case 'click':
    case 'extract':
      return `Click ${described}`;
  }
}

function idWords(action: RecordedAction): string[] {
  const subject = action.tool === 'navigate' ? (action.path ?? '') : (action.bundle?.describedAs ?? '');
  const named = subject.replace(/\{\{\s*inputs\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, ' $1 ');
  return [action.tool, ...named.split(/[^A-Za-z0-9]+/).filter((word) => word !== '')];
}

function uniqueId(words: readonly string[], taken: Set<string>): string {
  const [first = 'step', ...rest] = words;
  const base = `${first.toLowerCase()}${rest.map((word) => (word.length > 1 && word === word.toUpperCase() ? cap(word.toLowerCase()) : cap(word))).join('')}`.replace(/^[^a-z]+/, '') || 'step';
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}${suffix}`;
  taken.add(id);
  return id;
}

// A template written for a person, {{inputs.memberId}} reads as the memberId input.
function plain(text: string): string {
  return text.replace(/\{\{\s*inputs\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, 'the $1 input').replace(/\s+/g, ' ').trim();
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function templateInputs(text: string, inputs: Readonly<Record<string, string>>): string {
  let out = text;
  for (const [name, value] of Object.entries(inputs)) {
    if (value !== '') out = out.replace(wholeTokenPattern(value), `{{inputs.${name}}}`);
  }
  return out;
}

function mapBundle(bundle: LocatorBundle, map: (text: string) => string): LocatorBundle {
  return { ...bundle, describedAs: map(bundle.describedAs), strategies: bundle.strategies.map((strategy) => mapStrategy(strategy, map)) };
}

function mapStrategy(strategy: LocatorStrategy, map: (text: string) => string): LocatorStrategy {
  switch (strategy.kind) {
    case 'role-name':
      return { ...strategy, name: map(strategy.name) };
    case 'label':
    case 'text':
      return { ...strategy, text: map(strategy.text) };
    case 'test-id':
      return { ...strategy, value: map(strategy.value) };
    case 'structural':
      return { ...strategy, path: map(strategy.path) };
    case 'anchor-relative': {
      const anchor = strategy.anchor;
      return { ...strategy, anchor: anchor.kind === 'role-name' ? { ...anchor, name: map(anchor.name) } : { ...anchor, text: map(anchor.text) } };
    }
  }
}

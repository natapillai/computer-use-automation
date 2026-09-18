import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { ControlLostError, type ControlToken } from '../control/controlToken.js';
import type { GrantLedger } from '../core/policy/authorize.js';
import { resolveTemplate } from '../core/capability/resolveTemplate.js';
import type { AppProfile } from '../core/policy/profile.js';
import type { Redactor } from '../core/redaction/redactor.js';
import type { ActionSummary } from '../escalation/intervention.js';
import { matchStrategy } from '../core/surfaceModel/match.js';
import { progressHash } from '../core/surfaceModel/progressHash.js';
import { findNodeByRef } from '../core/surfaceModel/tree.js';
import type { EscalationChannel, Handover } from '../escalation/channel.js';
import { unclassifiedDialog } from '../escalation/unclassified.js';
import type { EscalationReason } from '../core/outcome/result.js';
import type { Observation, ResolvedAction } from '../core/surfaceModel/types.js';
import type { Clock } from '../runtime/clock.js';
import type { GuardedOutcome, GuardedSurface } from '../surface/guardedSurface.js';
import type { ModelClient } from './modelClient.js';
import { buildObservation } from './observation.js';
import { buildGoal, systemPrompt } from './prompt.js';
import type { RecordedAction, Recorder } from './recorder.js';
import { toolsFor } from './tools.js';

// The discovery loop, see docs/ARCHITECTURE.md section 6. Observe, decide, authorize, act,
// record, until the model calls done, a budget is spent, or the run is stuck. Budget
// exhaustion is a Timeout failure and never an escalation, because stuck means nobody knows
// what to do next and out of budget means the run knew and ran out of room. See ESCALATION.

// Why discovery stopped for a person. PolicyConfirmation is the write path, where nothing is
// wrong and the run is simply not allowed to submit on its own.
export type DiscoveryEscalation = Extract<EscalationReason, 'NoProgress' | 'ModelRequested' | 'UnclassifiedCondition' | 'PolicyConfirmation'>;

export interface DiscoveryBudgets {
  readonly maxModelCalls: number;
  readonly maxActions: number;
  readonly maxDurationMs: number;
}

export interface DiscoveryExchange {
  readonly index: number;
  readonly observationHash: string;
  readonly observationText: string;
  readonly response: Anthropic.Message;
}

export type DiscoveryEvent =
  | { readonly t: 'observation'; readonly at: string; readonly observationHash: string; readonly progressHash: string }
  | { readonly t: 'decision'; readonly at: string; readonly tool: string; readonly input: unknown }
  | { readonly t: 'action'; readonly at: string; readonly tool: string; readonly ok: boolean; readonly detail: string }
  | { readonly t: 'authorization'; readonly at: string; readonly tool: string; readonly verdict: 'allow' | 'deny' | 'confirm'; readonly rule?: string }
  | { readonly t: 'stuck'; readonly at: string; readonly detector: DiscoveryEscalation; readonly detail: string }
  | { readonly t: 'handback'; readonly at: string; readonly interventionId: string; readonly reason: DiscoveryEscalation; readonly approved: boolean };

export interface DiscoveryOptions {
  readonly surface: GuardedSurface;
  readonly control: ControlToken;
  readonly model: ModelClient;
  readonly modelId: string;
  readonly clock: Clock;
  readonly goal: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly profile: AppProfile;
  readonly redactor: Redactor;
  readonly budgets: DiscoveryBudgets;
  readonly entryPath: string;
  // Named so a write this run performs can be bound to an approval, exactly as replay binds
  // one. Without the ledger an approved write would re authorize, be told to confirm again,
  // and ask the same person the same question forever.
  readonly runId?: string;
  readonly grants?: GrantLedger;
  // Whether the request permits this run to change state. It decides only whether the model is
  // offered the submits flag at all. A submit the model declares anyway is still treated as a
  // write, because raising an action's effect is always the safe direction.
  readonly allowWrites?: boolean;
  readonly onEvent?: (event: DiscoveryEvent) => void;
  // Called as each exchange comes back, so the transcript is on disk while the run is still
  // going. A run that is killed at an intervention would otherwise leave nothing behind.
  readonly onExchange?: (exchange: DiscoveryExchange) => void;
  readonly recorder?: Recorder;
  // Called with the first observation, and with a fresh observation taken as the run ends, so
  // evidence is captured against refs that are current. Without it the loop takes no extra
  // observation.
  readonly capture?: (moment: 'initial' | 'final', observation: Observation) => Promise<void>;
  // Raises a live intervention when the run stops for a person, see docs/ESCALATION.md section
  // 3. Without it the loop still stops, because a run that does not know what to do next must
  // not keep acting, and the result still says why.
  readonly escalation?: EscalationChannel;
  // Refs for the screenshot and snapshot an intervention points at, written by the caller. The
  // same seam replay uses, so one console serves both phases.
  readonly interventionCapture?: () => Promise<{ readonly screenshotRef: string; readonly snapshotRef: string }>;
}

interface DiscoveryCommon {
  readonly modelCalls: number;
  readonly actions: number;
  readonly extracted: Readonly<Record<string, { readonly ref: string; readonly text: string }>>;
  readonly exchanges: readonly DiscoveryExchange[];
  readonly finalObservation: Observation | null;
}

export type DiscoveryResult =
  | (DiscoveryCommon & { readonly status: 'done' })
  | (DiscoveryCommon & { readonly status: 'escalated'; readonly reason: DiscoveryEscalation; readonly detail: string; readonly interventionId?: string })
  | (DiscoveryCommon & {
      readonly status: 'failure';
      readonly reason: 'Timeout' | 'ModelCallFailed' | 'ModelStopped' | 'PolicyDenied' | 'ControlLost' | 'SurfaceUnavailable' | 'GoalInvalid';
      readonly detail: string;
    });

type FailureReason = Extract<DiscoveryResult, { status: 'failure' }>['reason'];

interface Executed {
  readonly text: string;
  readonly isError: boolean;
  readonly terminal?: 'done' | 'escalated';
  readonly recordedIndex?: number;
}

// Only these change the page by design, so only these count toward NoProgress.
const ACTING_TOOLS: ReadonlySet<string> = new Set(['click', 'fill', 'select', 'press', 'navigate']);
const NO_PROGRESS_LIMIT = 3;
const MAX_HANDOVERS = 3;

// What the console tells the person to do. One line each, because the intervention already
// carries the explanation, the screen and what the run has just done.
const SUGGESTED: Readonly<Record<DiscoveryEscalation, string>> = {
  PolicyConfirmation: 'Check the screen, then release the session to approve this change, or abort to refuse it.',
  NoProgress: 'Move the session to where the run should be, then hand it back.',
  ModelRequested: 'Do whatever the run could not, then hand the session back.',
  UnclassifiedCondition: 'Deal with the dialog, then hand the session back.',
};
const MAX_TOKENS = 8_000;

// Ends the loop from any depth with a finished result. It never escapes runDiscovery.
class Finish {
  readonly result: DiscoveryResult;

  constructor(result: DiscoveryResult) {
    this.result = result;
  }
}

export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { surface, model, clock, budgets } = options;
  const started = clock.now().getTime();
  const writes = options.allowWrites === true;
  const tools = toolsFor(Object.keys(options.inputs), { writes });
  const system = systemPrompt({ writes });
  const extracted: Record<string, { ref: string; text: string }> = {};
  const exchanges: DiscoveryExchange[] = [];
  let modelCalls = 0;
  let actions = 0;
  let latest: Observation | null = null;
  // Rotated every time a person hands the session back, because the token the run held before
  // the handover died the moment they claimed it.
  let control = options.control;
  let handovers = 0;
  // Time a person held the session. The duration budget bounds how long the automation may
  // run, not how long somebody takes to read a screen and decide, so a handover that outlasts
  // the budget must not fail the run the moment it comes back.
  let pausedMs = 0;
  // What happened while the run was paused, carried to the next thing the model is shown.
  let pausedNote = '';

  const at = (): string => clock.now().toISOString();
  const emit = (event: DiscoveryEvent): void => options.onEvent?.(event);
  const common = (): DiscoveryCommon => ({ modelCalls, actions, extracted, exchanges, finalObservation: latest });
  const fail = (reason: FailureReason, detail: string): Finish => new Finish({ ...common(), status: 'failure', reason, detail });
  // The last few things the run did, so the person reading the console can see how it got
  // here without opening the trace. Descriptions come from the derived bundle, which is
  // already redacted, and never from anything the model wrote.
  const recentActions = (): ActionSummary[] =>
    (options.recorder?.actions() ?? []).slice(-5).map((action) => ({
      at: at(),
      kind: action.tool,
      describedAs: action.bundle?.describedAs ?? null,
      ok: action.ok === true,
    }));

  const stopped = (reason: DiscoveryEscalation, detail: string, interventionId?: string): Finish =>
    new Finish({ ...common(), status: 'escalated', reason, detail, ...(interventionId === undefined ? {} : { interventionId }) });

  // Hands the live session to a person and waits for them to give it back, per docs/ESCALATION
  // section 8. A run that gets the session back keeps going, because an escalation that always
  // ends the run is a stop and not a handoff. It throws a finished result when nobody can take
  // it, when they abort, or when the run has already asked a person MAX_HANDOVERS times, so a
  // loop that cannot make progress on its own cannot ask forever either.
  const handOver = async (reason: DiscoveryEscalation, detail: string): Promise<Extract<Handover, { kind: 'resumed' }>> => {
    emit({ t: 'stuck', at: at(), detector: reason, detail });
    if (options.escalation === undefined || latest === null) throw stopped(reason, detail);
    if (handovers >= MAX_HANDOVERS) throw stopped(reason, detail);
    handovers += 1;
    const pausedAt = clock.now().getTime();
    const refs = (await options.interventionCapture?.()) ?? { screenshotRef: 'none', snapshotRef: 'none' };
    const handover = await options.escalation.raise({
      sessionId: surface.sessionId,
      runId: options.runId ?? '',
      phase: 'discovery',
      reason,
      explanation: detail,
      suggestedAction: SUGGESTED[reason],
      goal: options.goal,
      url: latest.frames.find((frame) => frame.framePath.length === 0)?.url ?? '',
      framePath: [],
      screenshotRef: refs.screenshotRef,
      snapshotRef: refs.snapshotRef,
      recentActions: recentActions(),
    });
    pausedMs += clock.now().getTime() - pausedAt;
    if (handover.kind !== 'resumed') throw stopped(reason, detail, handover.interventionId);
    control = handover.token;
    emit({ t: 'handback', at: at(), interventionId: handover.interventionId, reason, approved: handover.approved });
    return handover;
  };

  const observe = async (): Promise<{ text: string; hash: string; progress: string; observation: Observation }> => {
    const observation = await surface.observe();
    latest = observation;
    const built = buildObservation(observation, { profile: options.profile, redactor: options.redactor, inputs: options.inputs });
    const progress = progressHash(observation);
    emit({ t: 'observation', at: at(), observationHash: built.hash, progressHash: createHash('sha256').update(progress).digest('hex').slice(0, 16) });
    return { ...built, progress, observation };
  };

  // A fresh observation as the run ends, taken only when evidence is captured, so the final
  // screenshot masks refs from the snapshot the driver holds now. A run that never reached a
  // page has nothing to capture.
  const captureEnd = async (result: DiscoveryResult): Promise<DiscoveryResult> => {
    if (options.capture === undefined || latest === null) return result;
    const { observation } = await observe();
    await options.capture('final', observation);
    return { ...result, finalObservation: observation };
  };

  // Wait for the first change a step caused, then until the surface stops changing, bounded.
  const settle = async (): Promise<void> => {
    if ((await surface.waitForChange(3_000)) === 'timeout') return;
    for (let i = 0; i < 10; i += 1) {
      await surface.observe();
      if ((await surface.waitForChange(400)) === 'timeout') return;
    }
  };

  // Every verdict, allow included, because an audit trail of refusals alone cannot say what
  // the run was permitted to do. See docs/EVIDENCE.md section 3.
  const emitAuthorization = (tool: string, outcome: GuardedOutcome): void => {
    if (outcome.kind === 'performed') emit({ t: 'authorization', at: at(), tool, verdict: 'allow' });
    else emit({ t: 'authorization', at: at(), tool, verdict: outcome.kind === 'denied' ? 'deny' : 'confirm', rule: outcome.decision.rule });
  };

  // A dialog the app profile does not claim stops the run here too. During discovery nothing
  // else knows what it is, and letting the model click it to find out is the failure this
  // whole detector exists to prevent. See docs/ESCALATION.md section 3.
  const stopOnUnclaimedDialog = async (observation: Observation): Promise<void> => {
    if (!observation.dialogOpen) return;
    const unclaimed = await unclassifiedDialog({
      observation,
      conditions: options.profile.conditions.map((condition) => condition.when),
      match: async (strategy, framePath) => matchStrategy(observation, strategy, framePath),
    });
    if (!unclaimed) return;
    await handOver('UnclassifiedCondition', 'A dialog is open that the app profile does not claim, so the run stopped rather than clicking it.');
    pausedNote += 'A person held the session while a dialog nobody had classified was open, and has handed it back. The observation below is the page as they left it. ';
  };

  const withRecord = (executed: Executed, recorded: RecordedAction | undefined): Executed =>
    recorded === undefined ? executed : { ...executed, recordedIndex: recorded.index };

  // What an approval is bound to. The description the recorder derived from the real element,
  // because that is what a person is shown, and the ref only when no bundle could be derived.
  const writeFor = (submits: boolean, recorded: RecordedAction | undefined, ref: string): { readonly targetKey: string } | undefined =>
    submits ? { targetKey: recorded?.bundle?.describedAs ?? ref } : undefined;

  const perform = async (action: ResolvedAction, framePath: readonly string[], write?: { readonly targetKey: string }): Promise<Executed> => {
    const stepId = `action${actions}`;
    const effect = write === undefined ? 'read' : 'write';
    const targetKey = write?.targetKey ?? null;
    const ask = (): Promise<GuardedOutcome> => surface.perform({ action, framePath, stepId, effect, targetKey }, control);

    let outcome = await ask();
    emitAuthorization(action.kind, outcome);
    if (outcome.kind === 'denied') return { text: `Policy denied this action. ${outcome.decision.reason}`, isError: true };
    if (outcome.kind === 'confirm') {
      // A declared write is never refused outright. It goes to a person, and only their
      // approval, spent once as a grant, lets it reach the surface. See docs/SAFETY.md.
      if (write === undefined) return { text: `This action needs a person to approve it. ${outcome.decision.reason}`, isError: true };
      const approval = await handOver('PolicyConfirmation', outcome.decision.reason);
      if (!approval.approved) {
        return { text: 'A person declined this action, so nothing was submitted and the page is unchanged. Do not try it again without a reason to think it will be approved.', isError: true };
      }
      options.grants?.issue({ runId: options.runId ?? '', stepId, targetKey });
      pausedNote += 'A person approved this action while the run was paused. They changed nothing else, so the page is as it was. ';
      outcome = await ask();
      emitAuthorization(action.kind, outcome);
      if (outcome.kind !== 'performed') return { text: 'The approval did not authorize this action, so nothing was submitted.', isError: true };
    }
    if (!outcome.result.ok) return { text: `The action failed. ${outcome.result.detail}`, isError: true };
    if (action.kind !== 'fill') await settle();
    const refused = surface.refusalsFor(stepId);
    if (refused.length > 0) return { text: `The network guard refused ${refused.length} request(s) this action caused.`, isError: true };
    return { text: 'Done.', isError: false };
  };

  const bad = (text: string): Executed => ({ text, isError: true });

  const execute = async (block: Anthropic.ToolUseBlock): Promise<Executed> => {
    const input = block.input;
    if (block.name === 'done') return { text: 'Finished.', isError: false, terminal: 'done' };
    if (block.name === 'escalate') return { text: readString(input, 'reason') ?? 'No reason given.', isError: false, terminal: 'escalated' };

    if (block.name === 'navigate') {
      const path = readString(input, 'path');
      const framePath = readStrings(input, 'framePath');
      if (path === null || framePath === null) return bad('navigate needs a path and a framePath.');
      const resolved = resolveTemplate(path, { inputs: options.inputs, outputs: {}, env: {} }, []);
      if (!resolved.ok) return bad(`The path names something that is not an input: ${resolved.references.join(', ')}.`);
      const before = latest;
      // The path as the model gave it, which can only carry templates, never the resolved one.
      const recorded = before === null ? undefined : options.recorder?.record({ tool: 'navigate', observation: before, path, framePath });
      return withRecord(await perform({ kind: 'navigate', path: resolved.text, framePath }, framePath), recorded);
    }

    const ref = readString(input, 'ref');
    const current = latest;
    const node = ref === null || current === null ? null : findNodeByRef(current.root, ref);
    if (ref === null || current === null || node === null) return bad(`There is no element with ref ${ref ?? '(none given)'} in the latest observation.`);

    // Each element action is recorded against the observation its ref came from, before the
    // page can change, with only the ref and names the recorder needs.
    switch (block.name) {
      case 'click': {
        const submits = readBoolean(input, 'submits');
        const recorded = options.recorder?.record({ tool: 'click', observation: current, ref, submits });
        return withRecord(await perform({ kind: 'click', ref }, node.framePath, writeFor(submits, recorded, ref)), recorded);
      }
      case 'fill':
      case 'select': {
        const name = readString(input, 'input');
        const value = name === null ? undefined : options.inputs[name];
        if (name === null || value === undefined) return bad(`${block.name} needs the name of an input.`);
        const recorded = options.recorder?.record({ tool: block.name, observation: current, ref, inputName: name });
        const done = block.name === 'fill' ? await perform({ kind: 'fill', ref, value }, node.framePath) : await perform({ kind: 'select', ref, value }, node.framePath);
        return withRecord(done, recorded);
      }
      case 'press': {
        const key = readString(input, 'key');
        if (key === null) return bad('press needs a key.');
        const submits = readBoolean(input, 'submits');
        const recorded = options.recorder?.record({ tool: 'press', observation: current, ref, key, submits });
        return withRecord(await perform({ kind: 'press', ref, key }, node.framePath, writeFor(submits, recorded, ref)), recorded);
      }
      case 'extract': {
        const output = readString(input, 'output');
        if (output === null) return bad('extract needs an output name.');
        const recorded = options.recorder?.record({ tool: 'extract', observation: current, ref, output });
        extracted[output] = { ref, text: node.value ?? node.name };
        return withRecord({ text: `Recorded ${output} from ${ref}.`, isError: false }, recorded);
      }
      default:
        return bad(`There is no tool named ${block.name}.`);
    }
  };

  try {
    const goal = buildGoal(options.goal, options.inputs);
    if (!goal.ok) {
      throw fail('GoalInvalid', goal.failure === 'GoalCarriesInput' ? `The goal carries the value of ${goal.inputs.join(', ')}. Write it as a template.` : `The goal names inputs nobody supplied: ${goal.references.join(', ')}.`);
    }

    const entry = await surface.perform({ action: { kind: 'navigate', path: options.entryPath, framePath: [] }, framePath: [], stepId: 'entry', effect: 'read', targetKey: null }, control);
    emitAuthorization('navigate', entry);
    if (entry.kind !== 'performed') throw fail('PolicyDenied', entry.decision.reason);
    if (!entry.result.ok) throw fail('SurfaceUnavailable', entry.result.detail);

    let seen = await observe();
    await options.capture?.('initial', seen.observation);
    await stopOnUnclaimedDialog(seen.observation);
    let unchanged = 0;
    const opening = pausedNote;
    pausedNote = '';
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${goal.text}\n\n${opening}Observation:\n${seen.text}` }];

    for (;;) {
      if (clock.now().getTime() - started - pausedMs > budgets.maxDurationMs) throw fail('Timeout', `The run passed its duration budget of ${budgets.maxDurationMs}ms.`);
      if (modelCalls >= budgets.maxModelCalls) throw fail('Timeout', `The run spent its budget of ${budgets.maxModelCalls} model calls.`);

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: options.modelId,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        // A snapshot, so a request that was sent or recorded never changes as the loop goes on.
        messages: [...messages],
      };
      modelCalls += 1;
      const answer = await model.next({ params, observationHash: seen.hash, observationText: seen.text });
      if (!answer.ok) throw fail('ModelCallFailed', answer.detail);

      const response = answer.response;
      const exchange: DiscoveryExchange = { index: exchanges.length, observationHash: seen.hash, observationText: seen.text, response };
      exchanges.push(exchange);
      options.onExchange?.(exchange);
      messages.push({ role: 'assistant', content: response.content });

      const stop: string = response.stop_reason ?? 'none';
      if (stop !== 'tool_use' && stop !== 'end_turn') throw fail('ModelStopped', `The model stopped with ${stop}.`);

      const uses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
      const [first, ...rest] = uses;
      if (first === undefined) {
        messages.push({ role: 'user', content: 'Use one tool per turn. Call done when the goal is complete.' });
        continue;
      }

      emit({ t: 'decision', at: at(), tool: first.name, input: first.input });
      const acting = ACTING_TOOLS.has(first.name);
      if (acting && actions >= budgets.maxActions) throw fail('Timeout', `The run spent its budget of ${budgets.maxActions} actions.`);
      if (acting) actions += 1;

      const before = seen.progress;
      const executed = await execute(first);
      emit({ t: 'action', at: at(), tool: first.name, ok: !executed.isError, detail: executed.text });
      if (executed.terminal === 'done') throw new Finish({ ...common(), status: 'done' });
      if (executed.terminal === 'escalated') {
        await handOver('ModelRequested', executed.text);
        pausedNote += 'A person held the session after you asked for help, and has handed it back. The observation below is the page as they left it. ';
      }

      seen = await observe();
      await stopOnUnclaimedDialog(seen.observation);
      if (executed.recordedIndex !== undefined) {
        options.recorder?.complete(executed.recordedIndex, { ok: !executed.isError, changed: seen.progress !== before });
      }
      if (acting) {
        unchanged = seen.progress === before ? unchanged + 1 : 0;
        if (unchanged >= NO_PROGRESS_LIMIT) {
          await handOver('NoProgress', `The page did not change across ${NO_PROGRESS_LIMIT} consecutive actions.`);
          // The count starts again, so a person who unstuck the page is not asked a second
          // time for the same reason before the run has had a chance to use what they did.
          unchanged = 0;
          seen = await observe();
          pausedNote += 'A person held the session because nothing you did was changing the page, and has handed it back. The observation below is the page as they left it. ';
        }
      }

      // What happened while the run was paused reaches the model with the page it left behind,
      // per docs/ESCALATION.md section 8. It prefixes the tool result rather than replacing it,
      // because the model still needs to know how its own action went.
      const note = pausedNote;
      pausedNote = '';
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: first.id, content: `${note}${executed.text}\n\nObservation:\n${seen.text}`, is_error: executed.isError },
          ...rest.map((block) => ({ type: 'tool_result' as const, tool_use_id: block.id, content: 'Not run. Use one tool per turn.', is_error: true })),
        ],
      });
    }
  } catch (error) {
    if (error instanceof Finish) return captureEnd(error.result);
    if (error instanceof ControlLostError) return captureEnd({ ...common(), status: 'failure', reason: 'ControlLost', detail: 'Control of the session moved to another holder.' });
    throw error;
  }
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value: unknown = Reflect.get(input, key);
  return typeof value === 'string' ? value : null;
}

function readBoolean(input: unknown, key: string): boolean {
  if (typeof input !== 'object' || input === null) return false;
  return Reflect.get(input, key) === true;
}

function readStrings(input: unknown, key: string): string[] | null {
  if (typeof input !== 'object' || input === null) return null;
  const value: unknown = Reflect.get(input, key);
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

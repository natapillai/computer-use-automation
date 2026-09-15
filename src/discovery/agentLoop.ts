import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { ControlLostError, type ControlToken } from '../control/controlToken.js';
import { resolveTemplate } from '../core/capability/resolveTemplate.js';
import type { AppProfile } from '../core/policy/profile.js';
import type { Redactor } from '../core/redaction/redactor.js';
import { progressHash } from '../core/surfaceModel/progressHash.js';
import { findNodeByRef } from '../core/surfaceModel/tree.js';
import type { Observation, ResolvedAction } from '../core/surfaceModel/types.js';
import type { Clock } from '../runtime/clock.js';
import type { GuardedSurface } from '../surface/guardedSurface.js';
import type { ModelClient } from './modelClient.js';
import { buildObservation } from './observation.js';
import { buildGoal, SYSTEM_PROMPT } from './prompt.js';
import { toolsFor } from './tools.js';

// The discovery loop, see docs/ARCHITECTURE.md section 6. Observe, decide, authorize, act,
// record, until the model calls done, a budget is spent, or the run is stuck. Budget
// exhaustion is a Timeout failure and never an escalation, because stuck means nobody knows
// what to do next and out of budget means the run knew and ran out of room. See ESCALATION.

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
  | { readonly t: 'stuck'; readonly at: string; readonly detector: 'NoProgress' | 'ModelRequested'; readonly detail: string };

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
  readonly onEvent?: (event: DiscoveryEvent) => void;
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
  | (DiscoveryCommon & { readonly status: 'escalated'; readonly reason: 'NoProgress' | 'ModelRequested'; readonly detail: string })
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
}

// Only these change the page by design, so only these count toward NoProgress.
const ACTING_TOOLS: ReadonlySet<string> = new Set(['click', 'fill', 'select', 'press', 'navigate']);
const NO_PROGRESS_LIMIT = 3;
const MAX_TOKENS = 8_000;

// Ends the loop from any depth with a finished result. It never escapes runDiscovery.
class Finish {
  readonly result: DiscoveryResult;

  constructor(result: DiscoveryResult) {
    this.result = result;
  }
}

export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { surface, control, model, clock, budgets } = options;
  const started = clock.now().getTime();
  const tools = toolsFor(Object.keys(options.inputs));
  const extracted: Record<string, { ref: string; text: string }> = {};
  const exchanges: DiscoveryExchange[] = [];
  let modelCalls = 0;
  let actions = 0;
  let latest: Observation | null = null;

  const at = (): string => clock.now().toISOString();
  const emit = (event: DiscoveryEvent): void => options.onEvent?.(event);
  const common = (): DiscoveryCommon => ({ modelCalls, actions, extracted, exchanges, finalObservation: latest });
  const fail = (reason: FailureReason, detail: string): Finish => new Finish({ ...common(), status: 'failure', reason, detail });
  const escalate = (reason: 'NoProgress' | 'ModelRequested', detail: string): Finish => {
    emit({ t: 'stuck', at: at(), detector: reason, detail });
    return new Finish({ ...common(), status: 'escalated', reason, detail });
  };

  const observe = async (): Promise<{ text: string; hash: string; progress: string }> => {
    const observation = await surface.observe();
    latest = observation;
    const built = buildObservation(observation, { profile: options.profile, redactor: options.redactor, inputs: options.inputs });
    const progress = progressHash(observation);
    emit({ t: 'observation', at: at(), observationHash: built.hash, progressHash: createHash('sha256').update(progress).digest('hex').slice(0, 16) });
    return { ...built, progress };
  };

  // Wait for the first change a step caused, then until the surface stops changing, bounded.
  const settle = async (): Promise<void> => {
    if ((await surface.waitForChange(3_000)) === 'timeout') return;
    for (let i = 0; i < 10; i += 1) {
      await surface.observe();
      if ((await surface.waitForChange(400)) === 'timeout') return;
    }
  };

  const perform = async (action: ResolvedAction, framePath: readonly string[]): Promise<Executed> => {
    const stepId = `action${actions}`;
    const outcome = await surface.perform({ action, framePath, stepId, effect: 'read', targetKey: null }, control);
    if (outcome.kind === 'denied') return { text: `Policy denied this action. ${outcome.decision.reason}`, isError: true };
    if (outcome.kind === 'confirm') return { text: `This action needs a person to approve it. ${outcome.decision.reason}`, isError: true };
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
      return perform({ kind: 'navigate', path: resolved.text, framePath }, framePath);
    }

    const ref = readString(input, 'ref');
    const current = latest;
    const node = ref === null || current === null ? null : findNodeByRef(current.root, ref);
    if (ref === null || node === null) return bad(`There is no element with ref ${ref ?? '(none given)'} in the latest observation.`);

    switch (block.name) {
      case 'click':
        return perform({ kind: 'click', ref }, node.framePath);
      case 'fill':
      case 'select': {
        const name = readString(input, 'input');
        const value = name === null ? undefined : options.inputs[name];
        if (value === undefined) return bad(`${block.name} needs the name of an input.`);
        return block.name === 'fill' ? perform({ kind: 'fill', ref, value }, node.framePath) : perform({ kind: 'select', ref, value }, node.framePath);
      }
      case 'press': {
        const key = readString(input, 'key');
        if (key === null) return bad('press needs a key.');
        return perform({ kind: 'press', ref, key }, node.framePath);
      }
      case 'extract': {
        const output = readString(input, 'output');
        if (output === null) return bad('extract needs an output name.');
        extracted[output] = { ref, text: node.value ?? node.name };
        return { text: `Recorded ${output} from ${ref}.`, isError: false };
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
    if (entry.kind !== 'performed') throw fail('PolicyDenied', entry.decision.reason);
    if (!entry.result.ok) throw fail('SurfaceUnavailable', entry.result.detail);

    let seen = await observe();
    let unchanged = 0;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `${goal.text}\n\nObservation:\n${seen.text}` }];

    for (;;) {
      if (clock.now().getTime() - started > budgets.maxDurationMs) throw fail('Timeout', `The run passed its duration budget of ${budgets.maxDurationMs}ms.`);
      if (modelCalls >= budgets.maxModelCalls) throw fail('Timeout', `The run spent its budget of ${budgets.maxModelCalls} model calls.`);

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: options.modelId,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools,
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages,
      };
      modelCalls += 1;
      const answer = await model.next({ params, observationHash: seen.hash, observationText: seen.text });
      if (!answer.ok) throw fail('ModelCallFailed', answer.detail);

      const response = answer.response;
      exchanges.push({ index: exchanges.length, observationHash: seen.hash, observationText: seen.text, response });
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
      if (executed.terminal === 'escalated') throw escalate('ModelRequested', executed.text);

      seen = await observe();
      if (acting) {
        unchanged = seen.progress === before ? unchanged + 1 : 0;
        if (unchanged >= NO_PROGRESS_LIMIT) {
          throw escalate('NoProgress', `The page did not change across ${NO_PROGRESS_LIMIT} consecutive actions.`);
        }
      }

      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: first.id, content: `${executed.text}\n\nObservation:\n${seen.text}`, is_error: executed.isError },
          ...rest.map((block) => ({ type: 'tool_result' as const, tool_use_id: block.id, content: 'Not run. Use one tool per turn.', is_error: true })),
        ],
      });
    }
  } catch (error) {
    if (error instanceof Finish) return error.result;
    if (error instanceof ControlLostError) return { ...common(), status: 'failure', reason: 'ControlLost', detail: 'Control of the session moved to another holder.' };
    throw error;
  }
}

function readString(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value: unknown = Reflect.get(input, key);
  return typeof value === 'string' ? value : null;
}

function readStrings(input: unknown, key: string): string[] | null {
  if (typeof input !== 'object' || input === null) return null;
  const value: unknown = Reflect.get(input, key);
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

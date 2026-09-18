import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import profileJson from '../../profiles/meridian-core.json' with { type: 'json' };
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createControlTokens, type SessionControlTokens } from '../control/controlToken.js';
import { Allowlist } from '../core/policy/allowlist.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { AppProfile } from '../core/policy/profile.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { ACTION_VERBS } from '../core/surfaceModel/types.js';
import { createTestClock, type TestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface, type GuardedAction, type GuardedSurface } from '../surface/guardedSurface.js';
import { runDiscovery, type DiscoveryBudgets, type DiscoveryEvent, type DiscoveryOptions } from './agentLoop.js';
import { createFakeModelClient, type FakeTurn } from './fakeModelClient.js';
import type { RaiseInput } from '../escalation/channel.js';
import { createRecorder, type Recorder } from './recorder.js';

const allowlist = Allowlist.parse({
  version: 1,
  origins: [
    {
      pattern: 'http://localhost:4010',
      description: 'Local MERIDIAN Core target app',
      allowedPaths: ['/servicing/**', '/member/**', '/auth/login'],
      deniedPaths: ['/admin/**', '/__control__/**', '/**/delete', '/**/wire/**'],
    },
  ],
  actions: { allowed: [...ACTION_VERBS], denied: [] },
  risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
  budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
  data: { neverPersist: [], redactPatterns: [{ name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' }] },
});

const profile = AppProfile.parse(profileJson);
const START = '2026-09-15T09:00:00.000Z';
const GOAL = 'Find the savings balance of the member whose member ID is {{inputs.memberId}}, and record it as savingsBalance.';

let toolIds = 0;
function call(name: string, input: Record<string, unknown> = {}): FakeTurn {
  toolIds += 1;
  return {
    respond: {
      id: `msg_${toolIds}`,
      type: 'message',
      role: 'assistant',
      model: 'fake',
      content: [{ type: 'tool_use', id: `toolu_${toolIds}`, name, input }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as Anthropic.Message,
  };
}

// The live session the console would be attached to. A test drives the handover through it.
type Session = { readonly tokens: SessionControlTokens; readonly clock: TestClock };
type EscalationFor = (session: Session) => NonNullable<DiscoveryOptions['escalation']>;

interface RunOptions {
  readonly turns: readonly FakeTurn[];
  readonly script?: MeridianScriptOptions;
  readonly budgets?: Partial<DiscoveryBudgets>;
  readonly goal?: string;
  readonly recorder?: Recorder;
  readonly capture?: DiscoveryOptions['capture'];
  readonly escalation?: DiscoveryOptions['escalation'] | EscalationFor;
}

async function discover(options: RunOptions) {
  const clock = createTestClock(START);
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(options.script), clock });
  const grants = createGrantLedger();
  const guarded = createGuardedSurface({
    driver,
    policy: { allowlist, phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants },
    runId: 'run_000001',
    baseUrl: 'http://localhost:4010',
  });
  // Every request the loop made of the surface, so a test can see the effect a step declared
  // and not only what the surface did with it.
  const performed: GuardedAction[] = [];
  const surface: GuardedSurface = {
    ...guarded,
    perform: (request, control) => {
      performed.push(request);
      return guarded.perform(request, control);
    },
  };
  const model = createFakeModelClient(options.turns);
  const events: DiscoveryEvent[] = [];
  const escalation = typeof options.escalation === 'function' ? options.escalation({ tokens, clock }) : options.escalation;
  const result = await runDiscovery({
    surface,
    control: tokens.issue('automation'),
    model,
    modelId: 'claude-sonnet-5',
    clock,
    goal: options.goal ?? GOAL,
    inputs: { memberId: '10001' },
    profile,
    redactor: createRedactor(allowlist.data),
    budgets: { maxModelCalls: 20, maxActions: 40, maxDurationMs: 300_000, ...options.budgets },
    entryPath: '/servicing',
    runId: 'run_000001',
    grants,
    onEvent: (event) => events.push(event),
    ...(options.recorder === undefined ? {} : { recorder: options.recorder }),
    ...(options.capture === undefined ? {} : { capture: options.capture }),
    ...(escalation === undefined ? {} : { escalation }),
  });
  return { result, driver, model, events, performed };
}

// The last tool result the loop sent back, as text.
function lastToolResult(request: { readonly params: Anthropic.MessageCreateParamsNonStreaming } | undefined): { text: string; isError: boolean } {
  const last = request?.params.messages.at(-1);
  const blocks = Array.isArray(last?.content) ? last.content : [];
  const result = blocks.find((block) => block.type === 'tool_result');
  if (result === undefined || result.type !== 'tool_result') throw new Error('The last message carries no tool result.');
  return { text: typeof result.content === 'string' ? result.content : JSON.stringify(result.content), isError: result.is_error === true };
}

const happyPath: FakeTurn[] = [
  call('fill', { ref: 'n3', input: 'memberId' }),
  call('click', { ref: 'n6' }),
  call('click', { ref: 'r1' }),
  call('extract', { ref: 's3', output: 'savingsBalance' }),
  call('done'),
];

describe('runDiscovery', () => {
  it('reaches done and records what the model extracted', async () => {
    const { result, model } = await discover({ turns: happyPath });

    expect(result).toMatchObject({ status: 'done', modelCalls: 5, actions: 3, extracted: { savingsBalance: { ref: 's3', text: '$4,250.75' } } });
    expect(result.exchanges.map((exchange) => exchange.index)).toEqual([0, 1, 2, 3, 4]);
    expect(model.requests).toHaveLength(5);
  });

  it('never sends an input value or a seeded balance to the model', async () => {
    const { model } = await discover({ turns: happyPath });

    const sent = JSON.stringify(model.requests);
    expect(sent).not.toContain('10001');
    expect(sent).not.toContain('4,250.75');
    expect(sent).toContain('{{inputs.memberId}}');
  });

  it('fails as Timeout when the model call budget is spent, and never sends the call after the last', async () => {
    const { result, model } = await discover({ turns: [call('click', { ref: 'n2' }), call('click', { ref: 'n4' }), call('done')], budgets: { maxModelCalls: 2 } });

    expect(result).toMatchObject({ status: 'failure', reason: 'Timeout', modelCalls: 2 });
    expect(model.requests).toHaveLength(2);
  });

  it('fails as Timeout when the action budget is spent', async () => {
    const { result, driver } = await discover({ turns: [call('fill', { ref: 'n3', input: 'memberId' }), call('click', { ref: 'n6' }), call('click', { ref: 'r1' })], budgets: { maxActions: 2 } });

    expect(result).toMatchObject({ status: 'failure', reason: 'Timeout', actions: 2 });
    expect(driver.performed.map((action) => action.kind)).toEqual(['navigate', 'fill', 'click']);
  });

  it('fails as Timeout when the run passes its duration', async () => {
    const { result } = await discover({ turns: [call('click', { ref: 'n2' }), call('click', { ref: 'n2' })], budgets: { maxDurationMs: 1_000 } });

    expect(result).toMatchObject({ status: 'failure', reason: 'Timeout' });
  });

  it('escalates NoProgress after three acting calls that change nothing', async () => {
    const { result, model, events } = await discover({ turns: [call('click', { ref: 'n2' }), call('click', { ref: 'n2' }), call('click', { ref: 'n4' }), call('done')] });

    expect(result).toMatchObject({ status: 'escalated', reason: 'NoProgress' });
    expect(model.requests).toHaveLength(3);
    expect(events).toContainEqual(expect.objectContaining({ t: 'stuck', detector: 'NoProgress' }));
  });

  it('does not count an extract as an acting call toward NoProgress', async () => {
    const { result } = await discover({
      turns: [call('click', { ref: 'n2' }), call('extract', { ref: 'h1', output: 'title' }), call('click', { ref: 'n2' }), call('extract', { ref: 'h1', output: 'title' }), call('done')],
    });

    expect(result.status).toBe('done');
  });

  it('treats a change of static text alone as no progress, so a ticking clock still escalates NoProgress', async () => {
    const { result } = await discover({ script: { clockTicks: true }, turns: [call('click', { ref: 'n2' }), call('click', { ref: 'n2' }), call('click', { ref: 'n2' }), call('done')] });

    expect(result).toMatchObject({ status: 'escalated', reason: 'NoProgress' });
  });

  it('raises ModelRequested when the model calls escalate, with its reason', async () => {
    const { result } = await discover({ turns: [call('escalate', { reason: 'The search form is missing.' })] });

    expect(result).toMatchObject({ status: 'escalated', reason: 'ModelRequested', detail: 'The search form is missing.' });
  });

  it('never lets a denied action reach the driver, and tells the model why', async () => {
    const { result, driver, model } = await discover({ turns: [call('navigate', { path: '/__control__/reset', framePath: ['content'] }), call('done')] });

    expect(result.status).toBe('done');
    expect(driver.performed.map((action) => action.kind)).toEqual(['navigate']);
    const reply = lastToolResult(model.requests[1]);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('Policy denied');
  });

  it('answers a ref that is not in the latest observation with a correction and a fresh observation', async () => {
    const { driver, model } = await discover({ turns: [call('click', { ref: 'e9999' }), call('done')] });

    expect(driver.performed).toHaveLength(1);
    const reply = lastToolResult(model.requests[1]);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('e9999');
    expect(reply.text).toContain('Observation:');
  });

  it('ends as a failure when a model call fails, after exactly that one call', async () => {
    const { result, model } = await discover({ turns: [{ fail: 'OverloadedError with status 529.' }] });

    expect(result).toMatchObject({ status: 'failure', reason: 'ModelCallFailed', detail: 'OverloadedError with status 529.' });
    expect(model.requests).toHaveLength(1);
  });

  it('hands the recorder each element action at the moment of acting, and nothing the model wrote but the ref', async () => {
    const recorder = createRecorder({ profile, redactor: createRedactor(allowlist.data), inputs: { memberId: '10001' } });
    await discover({
      recorder,
      turns: [
        call('fill', { ref: 'n3', input: 'memberId', selector: 'input#ctl00_cph_txt' }),
        call('click', { ref: 'n6', selector: 'td.btn' }),
        call('click', { ref: 'r1' }),
        call('extract', { ref: 's3', output: 'savingsBalance' }),
        call('done'),
      ],
    });

    const actions = recorder.actions();
    expect(actions.map((action) => action.tool)).toEqual(['fill', 'click', 'click', 'extract']);
    expect(actions.every((action) => action.bundle !== null)).toBe(true);
    expect(actions[0]).toMatchObject({ value: '{{inputs.memberId}}' });
    expect(actions[3]).toMatchObject({ output: 'savingsBalance' });
    expect(JSON.stringify(actions)).not.toMatch(/ctl00_cph_txt|td\.btn|10001/);
  });

  it('completes each recorded action with whether it succeeded and changed the page, and records every authorization verdict', async () => {
    const recorder = createRecorder({ profile, redactor: createRedactor(allowlist.data), inputs: { memberId: '10001' } });
    const { events } = await discover({ recorder, turns: happyPath });

    expect(recorder.actions().map((action) => [action.tool, action.ok, action.changed])).toEqual([
      ['fill', true, true],
      ['click', true, true],
      ['click', true, true],
      ['extract', true, false],
    ]);
    expect(events.filter((event) => event.t === 'authorization').map((event) => event.t === 'authorization' && event.verdict)).toEqual(['allow', 'allow', 'allow', 'allow']);

    const denied = await discover({ turns: [call('navigate', { path: '/__control__/reset', framePath: ['content'] }), call('done')] });
    expect(denied.events).toContainEqual(expect.objectContaining({ t: 'authorization', tool: 'navigate', verdict: 'deny', rule: 'deniedPath' }));
  });

  it('stops for a person when a dialog appears that the app profile does not claim, without asking the model about it', async () => {
    const { result, model } = await discover({ turns: [call('click', { ref: 'n6' }), call('done')], script: { searchLeadsTo: 'dialog' } });

    expect(result).toMatchObject({ status: 'escalated', reason: 'UnclassifiedCondition' });
    // One call made the click. Nothing asked the model what to do about the modal.
    expect(model.requests).toHaveLength(1);
  });

  it('raises a live intervention when the model asks for a person, and reports the id it raised', async () => {
    const raised: { reason: string; explanation: string; url: string | undefined }[] = [];
    const { result } = await discover({
      turns: [call('escalate', { reason: 'The search form is not on the page.' })],
      escalation: {
        raise: async (input) => {
          raised.push({ reason: input.reason, explanation: input.explanation, url: input.url });
          return { kind: 'unclaimed', interventionId: 'int_000001' };
        },
      },
    });

    expect(result).toMatchObject({ status: 'escalated', reason: 'ModelRequested', interventionId: 'int_000001' });
    expect(raised).toEqual([{ reason: 'ModelRequested', explanation: 'The search form is not on the page.', url: 'http://localhost:4010/servicing' }]);
  });

  it('raises a live intervention when nothing the model does changes the page', async () => {
    const reasons: string[] = [];
    const { result } = await discover({
      turns: [call('click', { ref: 'n1' }), call('click', { ref: 'n1' }), call('click', { ref: 'n1' }), call('done')],
      escalation: {
        raise: async (input) => {
          reasons.push(input.reason);
          return { kind: 'unclaimed', interventionId: 'int_000002' };
        },
      },
    });

    expect(result).toMatchObject({ status: 'escalated', reason: 'NoProgress', interventionId: 'int_000002' });
    expect(reasons).toEqual(['NoProgress']);
  });

  it('escalates without an intervention when no escalation channel is wired, because the loop still has to stop', async () => {
    const { result } = await discover({ turns: [call('escalate', { reason: 'No way forward.' })] });

    expect(result).toMatchObject({ status: 'escalated', reason: 'ModelRequested' });
    expect(result.status === 'escalated' && result.interventionId).toBeUndefined();
  });

  it('captures the first observation and a fresh one at the end, and ends the run on that fresh observation', async () => {
    const captured: [string, string | undefined][] = [];
    const { result } = await discover({
      turns: happyPath,
      capture: async (moment, observation) => {
        captured.push([moment, observation.frames.find((frame) => frame.framePath.join('/') === 'content')?.url]);
      },
    });

    expect(captured).toEqual([
      ['initial', 'http://localhost:4010/servicing/search'],
      ['final', 'http://localhost:4010/member/10001'],
    ]);
    expect(result.finalObservation?.frames).toContainEqual(expect.objectContaining({ url: 'http://localhost:4010/member/10001' }));
  });

  it('still captures the end of a run that failed', async () => {
    const moments: string[] = [];
    await discover({
      turns: [{ fail: 'OverloadedError with status 529.' }],
      capture: async (moment) => {
        moments.push(moment);
      },
    });

    expect(moments).toEqual(['initial', 'final']);
  });

  it('captures nothing when the run never reached a page', async () => {
    const moments: string[] = [];
    await discover({
      turns: [call('done')],
      goal: 'Find the savings balance of member 10001.',
      capture: async (moment) => {
        moments.push(moment);
      },
    });

    expect(moments).toEqual([]);
  });

  it('refuses a goal that carries an input value before anything is shown to the model', async () => {
    const { result, model, driver } = await discover({ turns: [call('done')], goal: 'Find the savings balance of member 10001.' });

    expect(result).toMatchObject({ status: 'failure', reason: 'GoalInvalid' });
    expect(model.requests).toHaveLength(0);
    expect(driver.performed).toHaveLength(0);
  });
  // The write path, S5-T06. A model declares a write with the submits flag. The flag widens
  // nothing on its own. It raises the step's effect to write, which policy answers with
  // confirm, so the action reaches a person before it reaches the surface.

  // A resumed handover, as the escalation channel returns one once the person releases.
  const released = (approved: boolean): EscalationFor =>
    ({ tokens }) => ({
      raise: async () => ({ kind: 'resumed', interventionId: 'int_000001', approved, token: tokens.issue('automation') }),
    });

  it('runs an undeclared click as a read, so a write the model never declared is refused by the network guard', async () => {
    const { performed } = await discover({ turns: [call('click', { ref: 'n6' }), call('done')] });

    expect(performed.filter((request) => request.stepId !== 'entry').map((request) => request.effect)).toEqual(['read']);
  });

  it('stops for a person when the model declares a write, and performs it once with a grant after approval', async () => {
    const reasons: string[] = [];
    const { result, performed, events } = await discover({
      turns: [call('click', { ref: 'n6', submits: true }), call('done')],
      escalation: ({ tokens }) => ({
        raise: async (input) => {
          reasons.push(input.reason);
          return { kind: 'resumed', interventionId: 'int_000001', approved: true, token: tokens.issue('automation') };
        },
      }),
    });

    expect(reasons).toEqual(['PolicyConfirmation']);
    expect(result.status).toBe('done');
    // Confirmed once, then performed once. The grant is spent, so it can never run twice.
    const writes = performed.filter((request) => request.effect === 'write');
    expect(writes).toHaveLength(2);
    expect(writes.every((request) => request.stepId === writes[0]?.stepId)).toBe(true);
    expect(events.filter((event) => event.t === 'authorization').map((event) => event.verdict)).toEqual(['allow', 'confirm', 'allow']);
  });

  it('never performs the write when the person declines, and lets the run carry on', async () => {
    const { result, performed, model } = await discover({
      turns: [call('click', { ref: 'n6', submits: true }), call('done')],
      escalation: released(false),
    });

    expect(result.status).toBe('done');
    expect(performed.filter((request) => request.effect === 'write')).toHaveLength(1);
    expect(lastToolResult(model.requests.at(-1)).text).toContain('declined');
  });

  it('carries on after a person hands the session back, telling the model what happened while it was paused', async () => {
    const { result, model } = await discover({
      turns: [call('escalate', { reason: 'The search form is not on the page.' }), call('done')],
      escalation: released(true),
    });

    expect(result.status).toBe('done');
    const handback = lastToolResult(model.requests.at(-1));
    expect(handback.text).toContain('A person held the session');
    expect(handback.text).toContain('Observation:');
    expect(model.requests).toHaveLength(2);
  });

  it('ends escalated when a person is asked too many times, rather than handing back forever', async () => {
    const asked: string[] = [];
    const { result } = await discover({
      turns: [...Array.from({ length: 6 }, () => call('escalate', { reason: 'Still stuck.' })), call('done')],
      escalation: ({ tokens }) => ({
        raise: async (input) => {
          asked.push(input.reason);
          return { kind: 'resumed', interventionId: 'int_000001', approved: true, token: tokens.issue('automation') };
        },
      }),
    });

    expect(asked).toHaveLength(3);
    expect(result).toMatchObject({ status: 'escalated', reason: 'ModelRequested' });
  });

  it('records each handback with why a person was asked and whether they approved', async () => {
    const { events } = await discover({
      turns: [call('click', { ref: 'n6', submits: true }), call('done')],
      escalation: released(true),
    });

    expect(events.filter((event) => event.t === 'handback')).toEqual([
      { t: 'handback', at: START, interventionId: 'int_000001', reason: 'PolicyConfirmation', approved: true },
    ]);
  });

  it('tells the person which session, which run and what the run has just done', async () => {
    const seen: RaiseInput[] = [];
    await discover({
      turns: [call('click', { ref: 'n6' }), call('escalate', { reason: 'Stuck.' })],
      recorder: createRecorder({ profile, redactor: createRedactor(allowlist.data), inputs: { memberId: '10001' } }),
      escalation: {
        raise: async (input) => {
          seen.push(input);
          return { kind: 'unclaimed', interventionId: 'int_000001' };
        },
      },
    });

    expect(seen[0]).toMatchObject({ sessionId: 'sess_000001', runId: 'run_000001', phase: 'discovery', goal: expect.stringContaining('{{inputs.memberId}}') });
    expect(seen[0]?.recentActions.map((action) => action.kind)).toEqual(['click']);
    expect(seen[0]?.recentActions[0]?.describedAs).not.toBeNull();
  });

  it('does not spend the run budget on the time a person held the session', async () => {
    const { result } = await discover({
      turns: [call('escalate', { reason: 'Stuck.' }), call('done')],
      budgets: { maxDurationMs: 60_000 },
      escalation: ({ tokens, clock }) => ({
        raise: async () => {
          // Ten minutes of somebody reading the screen and deciding.
          clock.advance(600_000);
          return { kind: 'resumed', interventionId: 'int_000001', approved: true, token: tokens.issue('automation') };
        },
      }),
    });

    expect(result.status).toBe('done');
  });

  it('ends escalated when nobody claims the session', async () => {
    const { result } = await discover({
      turns: [call('escalate', { reason: 'No way forward.' }), call('done')],
      escalation: () => ({ raise: async () => ({ kind: 'unclaimed', interventionId: 'int_000009' }) }),
    });

    expect(result).toMatchObject({ status: 'escalated', reason: 'ModelRequested', interventionId: 'int_000009' });
  });
});

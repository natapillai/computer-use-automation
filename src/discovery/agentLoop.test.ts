import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import profileJson from '../../profiles/meridian-core.json' with { type: 'json' };
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createControlTokens } from '../control/controlToken.js';
import { Allowlist } from '../core/policy/allowlist.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { AppProfile } from '../core/policy/profile.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { ACTION_VERBS } from '../core/surfaceModel/types.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { runDiscovery, type DiscoveryBudgets, type DiscoveryEvent } from './agentLoop.js';
import { createFakeModelClient, type FakeTurn } from './fakeModelClient.js';
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

interface RunOptions {
  readonly turns: readonly FakeTurn[];
  readonly script?: MeridianScriptOptions;
  readonly budgets?: Partial<DiscoveryBudgets>;
  readonly goal?: string;
  readonly recorder?: Recorder;
}

async function discover(options: RunOptions) {
  const clock = createTestClock(START);
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(options.script), clock });
  const surface = createGuardedSurface({
    driver,
    policy: { allowlist, phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants: createGrantLedger() },
    runId: 'run_000001',
    baseUrl: 'http://localhost:4010',
  });
  const model = createFakeModelClient(options.turns);
  const events: DiscoveryEvent[] = [];
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
    onEvent: (event) => events.push(event),
    ...(options.recorder === undefined ? {} : { recorder: options.recorder }),
  });
  return { result, driver, model, events };
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

  it('refuses a goal that carries an input value before anything is shown to the model', async () => {
    const { result, model, driver } = await discover({ turns: [call('done')], goal: 'Find the savings balance of member 10001.' });

    expect(result).toMatchObject({ status: 'failure', reason: 'GoalInvalid' });
    expect(model.requests).toHaveLength(0);
    expect(driver.performed).toHaveLength(0);
  });
});

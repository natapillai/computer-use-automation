import type Anthropic from '@anthropic-ai/sdk';
import profileJson from '../../../profiles/meridian-core.json' with { type: 'json' };
import { createControlTokens } from '../../../src/control/controlToken.js';
import { Allowlist } from '../../../src/core/policy/allowlist.js';
import { createGrantLedger } from '../../../src/core/policy/authorize.js';
import { AppProfile } from '../../../src/core/policy/profile.js';
import { createRedactor, type Redactor } from '../../../src/core/redaction/redactor.js';
import { ACTION_VERBS } from '../../../src/core/surfaceModel/types.js';
import { runDiscovery, type DiscoveryEvent } from '../../../src/discovery/agentLoop.js';
import { createFakeModelClient, type FakeTurn } from '../../../src/discovery/fakeModelClient.js';
import { createRecorder } from '../../../src/discovery/recorder.js';
import { buildTrace, type RunTrace } from '../../../src/discovery/trace.js';
import { createTestClock } from '../../../src/runtime/clock.js';
import { createSequentialIds } from '../../../src/runtime/ids.js';
import { createFakeSurfaceDriver } from '../../../src/surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../../../src/surface/guardedSurface.js';
import { meridianScript, type MeridianScriptOptions } from '../surface/meridianScreens.js';

// A discovery run against the scripted MERIDIAN screens with a scripted model, for tests that
// need a real trace without a browser or an API.

export const profile = AppProfile.parse(profileJson);

export const allowlist = Allowlist.parse({
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

export const redactor: Redactor = createRedactor(allowlist.data);

export const GOAL = 'Find the savings balance of the member whose member ID is {{inputs.memberId}}, and record it as savingsBalance.';

let toolIds = 0;
export function call(name: string, input: Record<string, unknown> = {}): FakeTurn {
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

export function happyPathTurns(): FakeTurn[] {
  return [
    call('fill', { ref: 'n3', input: 'memberId' }),
    call('click', { ref: 'n6' }),
    call('click', { ref: 'r1' }),
    call('extract', { ref: 's3', output: 'savingsBalance' }),
    call('done'),
  ];
}

export async function runFakeDiscovery(turns: readonly FakeTurn[] = happyPathTurns(), script: MeridianScriptOptions = {}) {
  const clock = createTestClock('2026-09-15T09:00:00.000Z');
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(script), clock });
  const surface = createGuardedSurface({
    driver,
    policy: { allowlist, phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants: createGrantLedger() },
    runId: 'run_000001',
    baseUrl: 'http://localhost:4010',
  });
  const recorder = createRecorder({ profile, redactor, inputs: { memberId: '10001' } });
  const events: DiscoveryEvent[] = [];
  const result = await runDiscovery({
    surface,
    control: tokens.issue('automation'),
    model: createFakeModelClient(turns),
    modelId: 'claude-sonnet-5',
    clock,
    goal: GOAL,
    inputs: { memberId: '10001' },
    profile,
    redactor,
    budgets: { maxModelCalls: 20, maxActions: 40, maxDurationMs: 300_000 },
    entryPath: '/servicing',
    onEvent: (event) => events.push(event),
    recorder,
  });
  const trace: RunTrace = buildTrace({ runId: 'run_000001', goal: GOAL, inputNames: ['memberId'], result, recorder, events });
  return { result, recorder, events, driver, trace };
}

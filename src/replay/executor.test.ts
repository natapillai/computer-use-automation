import { describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../tests/fixtures/capabilities/readSavingsBalance.js';
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createControlTokens } from '../control/controlToken.js';
import { Capability, type CapabilityInput } from '../core/capability/schema.js';
import type { FailureDetail, ReplayResult } from '../core/outcome/result.js';
import { Allowlist } from '../core/policy/allowlist.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { ACTION_VERBS } from '../core/surfaceModel/types.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { replay } from './executor.js';

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
  actions: { allowed: [...ACTION_VERBS], denied: ['upload', 'download', 'execScript', 'newTab', 'clipboardRead'] },
  risk: { unclassified: 'deny', writeHandling: 'confirm', sensitiveHandling: 'allow_redacted' },
  budgets: { maxStepsPerRun: 40, maxModelCallsPerRun: 40, maxRunDurationMs: 300_000 },
  data: { neverPersist: ['password'], redactPatterns: [] },
});

const START = '2026-09-14T09:00:00.000Z';

interface RunOptions {
  readonly script?: MeridianScriptOptions;
  readonly memberId?: string;
  readonly capability?: CapabilityInput;
}

async function run(options: RunOptions = {}) {
  const clock = createTestClock(START);
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(options.script), clock });
  const surface = createGuardedSurface({
    driver,
    policy: { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() },
    runId: 'run_000001',
    baseUrl: 'http://localhost:4010',
  });
  const capability = Capability.parse(options.capability ?? readSavingsBalanceFixture());
  const result = await replay(capability, { memberId: options.memberId ?? '10001' }, { surface, control: tokens.issue('automation'), clock, runId: 'run_000001' });
  return { result, driver, elapsedMs: clock.now().getTime() - Date.parse(START) };
}

function failureOf(result: ReplayResult): FailureDetail {
  if (result.status !== 'failure') throw new Error(`Expected a failure but the run ended as ${result.status}.`);
  return result.failure;
}

describe('replay', () => {
  it('returns the savings balance of member 10001 as 425075 minor units of USD', async () => {
    const { result, driver } = await run();

    expect(result).toMatchObject({
      status: 'success',
      runId: 'run_000001',
      capability: { id: 'member.readSavingsBalance', version: '1.0.0' },
      inputNames: ['memberId'],
      stepsAttempted: 4,
      stepsCompleted: 4,
      recoveries: [],
      interventions: [],
      drift: [],
    });
    if (result.status !== 'success') return;
    expect(result.outputs).toEqual({ savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' } });
    expect(driver.performed.map((action) => action.kind)).toEqual(['navigate', 'navigate', 'fill', 'click', 'click']);
  });

  it('classifies the no records banner as MEMBER_NOT_FOUND at once, not after the step timeout', async () => {
    const { result, driver, elapsedMs } = await run({ memberId: '00000', script: { searchLeadsTo: 'noRecords' } });

    expect(result).toMatchObject({
      status: 'business_outcome',
      outcome: { code: 'MEMBER_NOT_FOUND', terminal: true },
      stepsAttempted: 3,
      stepsCompleted: 2,
    });
    expect(elapsedMs).toBe(0);
    expect(driver.performed).toHaveLength(4);
  });

  it('fails with Timeout naming the awaited condition when the surface never changes', async () => {
    const { result, elapsedMs } = await run({ script: { searchLeadsTo: 'nowhere' } });
    const failure = failureOf(result);

    expect(failure).toMatchObject({ class: 'Timeout', atStepId: 'submitSearch', stepIntent: 'Submit the member search form', retryable: false });
    expect(failure.observed).toContain('waiting for: A result row for the member is present');
    expect(elapsedMs).toBe(10_000);
  });

  it('fails with CheckpointFailed when the page changes but the expected state never appears', async () => {
    const failure = failureOf((await run({ script: { searchLeadsTo: 'wrongPage' } })).result);

    expect(failure).toMatchObject({
      class: 'CheckpointFailed',
      atStepId: 'submitSearch',
      expected: 'A result row for the member is present',
      observed: 'Result row link for the member did not resolve.',
    });
  });

  it('fails with OutputUnresolvable without repeating the page text when the balance does not parse', async () => {
    const { result } = await run({ script: { balance: 'N/A' } });
    const failure = failureOf(result);

    expect(failure).toMatchObject({ class: 'OutputUnresolvable', atStepId: 'openMemberDetail' });
    expect(JSON.stringify(result)).not.toContain('N/A');
  });

  it('rejects bad input before anything reaches the surface', async () => {
    const { result, driver } = await run({ memberId: 'abc' });

    expect(failureOf(result)).toMatchObject({ class: 'InputValidation', atStepId: null });
    expect(driver.performed).toEqual([]);
  });

  it('stops with PolicyDenied before an entry path the allowlist denies', async () => {
    const fixture = readSavingsBalanceFixture();
    const { result, driver } = await run({ capability: { ...fixture, app: { ...fixture.app, entryPath: '/admin/console' } } });

    expect(failureOf(result)).toMatchObject({ class: 'PolicyDenied', atStepId: null });
    expect(driver.performed).toEqual([]);
  });

  it('fails with LocatorAmbiguous and every attempt when the search button matches twice', async () => {
    const failure = failureOf((await run({ script: { duplicateSearchButton: true } })).result);

    expect(failure).toMatchObject({ class: 'LocatorAmbiguous', atStepId: 'submitSearch' });
    expect(failure.locatorAttempts?.map((attempt) => attempt.outcome)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('records drift when a lower ranked strategy finds the relabelled member ID input', async () => {
    const { result } = await run({ script: { memberLabel: 'Account Holder ID:' } });

    expect(result.status).toBe('success');
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({ describedAs: 'Member ID input', preferredKind: 'anchor-relative', winningIndex: 1 });
  });
});

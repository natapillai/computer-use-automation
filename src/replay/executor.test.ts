import { describe, expect, it } from 'vitest';
import profileJson from '../../profiles/meridian-core.json' with { type: 'json' };
import { readSavingsBalanceFixture } from '../../tests/fixtures/capabilities/readSavingsBalance.js';
import { AppProfile } from '../core/policy/profile.js';
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createControlTokens, type SessionControlTokens } from '../control/controlToken.js';
import type { EscalationChannel, RaiseInput } from '../escalation/channel.js';
import { Capability, type CapabilityInput } from '../core/capability/schema.js';
import type { FailureDetail, ReplayResult } from '../core/outcome/result.js';
import { Allowlist } from '../core/policy/allowlist.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { ACTION_VERBS } from '../core/surfaceModel/types.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import type { ResolvedAction } from '../core/surfaceModel/types.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { createStepScope, type StepScope } from '../surface/stepScope.js';
import type { SurfaceDriver } from '../surface/types.js';
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

const profile = AppProfile.parse(profileJson);

// The fixture with the search step's condition rules replaced, for the precedence table.
function withSearchRules(rules: NonNullable<CapabilityInput['steps'][number]['onCondition']>): CapabilityInput {
  const fixture = readSavingsBalanceFixture();
  return { ...fixture, steps: fixture.steps.map((step) => (step.id === 'submitSearch' ? { ...step, onCondition: rules } : step)) };
}

function noRecordsBanner() {
  const rule = readSavingsBalanceFixture().steps.find((step) => step.id === 'submitSearch')?.onCondition?.[0];
  if (rule === undefined) throw new Error('The fixture search step has no condition rule.');
  return rule.when;
}

// A scripted person on the other end of a handoff. act is what they did to the page while they
// held it, performed with a human token, exactly as a real claim would.
type HandoverScript =
  | { readonly kind: 'resumed'; readonly approved?: boolean; readonly act?: (driver: SurfaceDriver, tokens: SessionControlTokens) => Promise<void> }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'unclaimed' };

interface RunOptions {
  readonly script?: MeridianScriptOptions;
  readonly memberId?: string;
  readonly capability?: CapabilityInput;
  readonly handovers?: readonly HandoverScript[];
  // Stands in for the network guard, which the fake has no network to run.
  readonly afterAct?: (action: ResolvedAction, scope: StepScope) => void;
}

async function run(options: RunOptions = {}) {
  const clock = createTestClock(START);
  const tokens = createControlTokens('sess_000001', createSequentialIds());
  const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(options.script), clock });
  const scope = createStepScope();
  const acting: SurfaceDriver = {
    ...driver,
    act: async (action, token) => {
      const result = await driver.act(action, token);
      options.afterAct?.(action, scope);
      return result;
    },
  };
  const grants = createGrantLedger();
  const surface = createGuardedSurface({
    driver: acting,
    scope,
    policy: { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants },
    runId: 'run_000001',
    baseUrl: 'http://localhost:4010',
  });
  const capability = Capability.parse(options.capability ?? readSavingsBalanceFixture());

  const raised: RaiseInput[] = [];
  const escalation: EscalationChannel = {
    raise: async (input) => {
      raised.push(input);
      const next = options.handovers?.[raised.length - 1];
      if (next === undefined) throw new Error(`The run raised intervention ${raised.length} and the script has ${options.handovers?.length ?? 0}.`);
      if (next.kind !== 'resumed') return { kind: next.kind, interventionId: `int_${raised.length}` };
      await next.act?.(acting, tokens);
      // Control rotated while the person held it, so the run is handed a token nobody else saw.
      return { kind: 'resumed', interventionId: `int_${raised.length}`, approved: next.approved ?? false, token: tokens.issue('automation') };
    },
  };

  const result = await replay(capability, { memberId: options.memberId ?? '10001' }, {
    surface,
    control: tokens.issue('automation'),
    clock,
    runId: 'run_000001',
    profile,
    ...(options.handovers === undefined ? {} : { escalation, grants }),
  });
  return { result, driver, raised, elapsedMs: clock.now().getTime() - Date.parse(START) };
}

// The same capability with its search step declared a write, which is what makes the policy ask
// a person before it runs.
function needsApproval(): CapabilityInput {
  const fixture = readSavingsBalanceFixture();
  return {
    ...fixture,
    policy: { ...fixture.policy, maxEffect: 'write' },
    steps: fixture.steps.map((step) => (step.id === 'submitSearch' ? { ...step, effect: 'write' } : step)),
  };
}

function failureOf(result: ReplayResult): FailureDetail {
  if (result.status !== 'failure') throw new Error(`Expected a failure but the run ended as ${result.status}.`);
  return result.failure;
}

describe('replay with a person on the other end', () => {
  it('asks before a write, performs it once the person approves, and finishes the run', async () => {
    const { result, raised, driver } = await run({ capability: needsApproval(), handovers: [{ kind: 'resumed', approved: true }] });

    expect(raised.map((input) => input.reason)).toEqual(['PolicyConfirmation']);
    expect(raised[0]).toMatchObject({ phase: 'replay', capability: { id: 'member.readSavingsBalance' }, atStep: { id: 'submitSearch' } });
    expect(result).toMatchObject({ status: 'success', interventions: [{ reason: 'PolicyConfirmation', atStepId: 'submitSearch', disposition: 'resumed' }] });
    // The approved action ran once, not twice.
    expect(driver.performed.filter((action) => action.kind === 'click')).toHaveLength(2);
  });

  it('ends as escalated when nobody claims the session', async () => {
    const { result } = await run({ capability: needsApproval(), handovers: [{ kind: 'unclaimed' }] });

    expect(result).toMatchObject({
      status: 'escalated',
      intervention: { reason: 'PolicyConfirmation', atStepId: 'submitSearch', disposition: 'unclaimed' },
      stepsCompleted: 2,
    });
  });

  it('ends as escalated when the person ends the run', async () => {
    const { result } = await run({ capability: needsApproval(), handovers: [{ kind: 'aborted' }] });

    expect(result).toMatchObject({ status: 'escalated', intervention: { disposition: 'aborted' } });
  });

  it('reports success when the person finished the task instead of approving the action', async () => {
    const { result } = await run({
      capability: needsApproval(),
      handovers: [
        {
          kind: 'resumed',
          act: async (driver, tokens) => {
            const human = tokens.issue('human');
            await driver.act({ kind: 'click', ref: 'n6' }, human);
            await driver.act({ kind: 'click', ref: 'r1' }, human);
          },
        },
      ],
    });

    expect(result).toMatchObject({ status: 'success', interventions: [{ disposition: 'resumed' }] });
    if (result.status !== 'success') return;
    expect(result.outputs).toEqual({ savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' } });
  });

  it('hands the session straight back when the release left the run nowhere it can carry on from', async () => {
    const { result, raised } = await run({ capability: needsApproval(), handovers: [{ kind: 'resumed' }, { kind: 'aborted' }] });

    expect(raised.map((input) => input.reason)).toEqual(['PolicyConfirmation', 'resumePreconditionFailed']);
    expect(result).toMatchObject({ status: 'escalated', intervention: { reason: 'resumePreconditionFailed', disposition: 'aborted' } });
    expect(result.interventions).toHaveLength(2);
  });

  // S6-T02. A transient load is routine on this surface and recoverable, so a capability that
  // was working correctly must not report as broken. The retry only ever applies to a step that
  // declares itself idempotent, because repeating a submit risks posting it twice.

  // The committed capability declares its search not idempotent, which is right, because the
  // app profile says the search POST is not. Both sides of the gate need a case, so these two
  // are the same capability with that one declaration flipped.
  const searchDeclaredAs = (idempotent: boolean): CapabilityInput => {
    const fixture = readSavingsBalanceFixture();
    return {
      ...fixture,
      steps: fixture.steps.map((step) =>
        step.id === 'submitSearch' ? { ...step, idempotent, retry: idempotent ? { attempts: 2, backoffMs: 500 } : { attempts: 0 } } : step,
      ),
    };
  };

  it('retries an idempotent step through a transient load, and reports the recovery on the run that then worked', async () => {
    const { result, elapsedMs } = await run({ script: { flakyOnce: true }, capability: searchDeclaredAs(true) });

    expect(result.status).toBe('success');
    expect(result.recoveries).toEqual([{ condition: 'TransientLoad', atStepId: 'submitSearch', attempt: 1, resolved: true }]);
    // One backoff, spent on the clock rather than on a timer nobody can see.
    expect(elapsedMs).toBeGreaterThanOrEqual(500);
  });

  it('backs off further on each attempt, and stops after three', async () => {
    const { result, elapsedMs } = await run({ script: { flakyOnce: true, searchLeadsTo: 'nowhere' }, capability: searchDeclaredAs(true) });

    expect(failureOf(result)).toMatchObject({ class: 'SurfaceUnavailable', atStepId: 'submitSearch', retryable: true });
    expect(result.recoveries.map((record) => [record.attempt, record.resolved])).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
    // 500 then 1000, and the third attempt fails rather than waiting again.
    expect(elapsedMs).toBeGreaterThanOrEqual(1_500);
  });

  it('never retries a step that is not idempotent, because repeating a submit risks posting it twice', async () => {
    const { result, elapsedMs } = await run({ script: { flakyOnce: true }, capability: searchDeclaredAs(false) });

    expect(failureOf(result)).toMatchObject({ class: 'SurfaceUnavailable', atStepId: 'submitSearch', retryable: true });
    expect(result.recoveries).toEqual([]);
    // Nothing was waited on, because nothing was going to be tried again.
    expect(elapsedMs).toBe(0);
  });

  it('ends as Timeout when the run passes the duration the capability allows', async () => {
    const fixture = searchDeclaredAs(true);
    const tight: CapabilityInput = { ...fixture, policy: { ...fixture.policy, maxTotalDurationMs: 400 } };

    const { result } = await run({ script: { flakyOnce: true }, capability: tight });

    // The backoff spends more than the budget, and the next step is the one that notices.
    expect(failureOf(result)).toMatchObject({ class: 'Timeout', retryable: true });
    // The budget it broke and what it had actually spent, because a timeout that names neither
    // sends whoever reads it to guess which of the two was wrong.
    expect(failureOf(result).expected).toContain('400ms');
    expect(failureOf(result).observed).toContain('500ms');
  });

  it('stops handing back after three tries on one step, because a loop is not an escalation', async () => {
    const { result, raised } = await run({
      capability: needsApproval(),
      handovers: [{ kind: 'resumed' }, { kind: 'resumed' }, { kind: 'resumed' }, { kind: 'resumed' }],
    });

    expect(raised).toHaveLength(3);
    // Nothing denied this run. Three people looked at it and the step still cannot run, which
    // is a precondition that does not hold and not a policy refusal.
    expect(failureOf(result)).toMatchObject({ class: 'PreconditionFailed', atStepId: 'submitSearch' });
    expect(failureOf(result).observed).toContain('three');
  });

  it('stops on a dialog no rule claims, never clicks it, and carries on once a person clears it', async () => {
    const { result, raised, driver } = await run({
      script: { searchLeadsTo: 'dialog' },
      handovers: [
        {
          kind: 'resumed',
          act: async (driver, tokens) => {
            await driver.act({ kind: 'click', ref: 'g3' }, tokens.issue('human'));
          },
        },
      ],
    });

    expect(raised.map((input) => input.reason)).toEqual(['UnclassifiedCondition']);
    expect(result).toMatchObject({ status: 'success', interventions: [{ reason: 'UnclassifiedCondition', disposition: 'resumed' }] });
    // The automation never touched the modal. Only the person did, and only the OK cell.
    expect(driver.performed.filter((action) => action.kind === 'click' && action.ref === 'g1')).toEqual([]);
  });

  it('does not escalate a dialog a rule claims, because then the system knows what it is', async () => {
    const fixture = readSavingsBalanceFixture();
    const claimed: CapabilityInput = {
      ...fixture,
      outcomes: [...fixture.outcomes, { code: 'SESSION_NOTICE', description: 'The app asked the operator to contact the service desk.', terminal: true, provenance: 'manual', detect: { kind: 'dialogPresent' } }],
    };

    const { result, raised } = await run({ script: { searchLeadsTo: 'dialog' }, capability: claimed, handovers: [] });

    expect(raised).toEqual([]);
    expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'SESSION_NOTICE' } });
  });

  it('advances when the person left the page where the step was trying to get to', async () => {
    const { result } = await run({
      capability: needsApproval(),
      handovers: [
        {
          kind: 'resumed',
          act: async (driver, tokens) => {
            await driver.act({ kind: 'click', ref: 'n6' }, tokens.issue('human'));
          },
        },
      ],
    });

    expect(result).toMatchObject({ status: 'success', stepsCompleted: 4 });
  });
});

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

  it('ends as SurfaceUnavailable when a transient load lands on a step that cannot be repeated', async () => {
    const { result, driver } = await run({ script: { resultsStatus: 503 } });
    const failure = failureOf(result);

    expect(failure).toMatchObject({ class: 'SurfaceUnavailable', atStepId: 'submitSearch', retryable: true });
    expect(failure.observed).toContain('not idempotent');
    // Submitted once. Repeating a submit that may already have posted is the danger here.
    expect(driver.performed.filter((action) => action.kind === 'click')).toHaveLength(1);
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

  it('fails with PolicyDenied when the network guard refused a request during the step, even though the page moved on', async () => {
    const { result } = await run({
      afterAct: (action, scope) => {
        if (action.kind === 'click' && action.ref === 'n6') scope.refuse('effect');
      },
    });

    expect(failureOf(result)).toMatchObject({ class: 'PolicyDenied', atStepId: 'submitSearch', cause: 'rule effect' });
    expect(result.stepsCompleted).toBe(2);
  });

  describe('classification precedence, step rules then capability outcomes then the app profile then the postcondition', () => {
    it('classifies a redirect to the login page as SessionExpired from the app profile, at once', async () => {
      const { result, elapsedMs } = await run({ script: { searchLeadsTo: 'loginRedirect' } });

      expect(failureOf(result)).toMatchObject({ class: 'SessionExpired', atStepId: 'submitSearch', retryable: false });
      expect(failureOf(result).observed).toContain('SessionExpired');
      expect(elapsedMs).toBe(0);
    });

    it('lets a profile condition win over a postcondition that also holds', async () => {
      const { result } = await run({ script: { resultsPath: '/auth/login' } });

      expect(failureOf(result)).toMatchObject({ class: 'SessionExpired', atStepId: 'submitSearch' });
    });

    it('lets a capability outcome win over a profile condition that also holds', async () => {
      const { result } = await run({ memberId: '00000', script: { searchLeadsTo: 'noRecords', resultsPath: '/auth/login' } });

      expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND' } });
    });

    it('lets a step rule win over a capability outcome that also holds, and fails with the class it names', async () => {
      const capability = withSearchRules([{ when: noRecordsBanner(), classify: 'failure', code: 'SurfaceUnavailable' }]);
      const { result } = await run({ memberId: '00000', capability, script: { searchLeadsTo: 'noRecords' } });

      expect(failureOf(result)).toMatchObject({ class: 'SurfaceUnavailable', atStepId: 'submitSearch' });
    });

    it('lets a business outcome beat a failure within the step rules', async () => {
      const capability = withSearchRules([
        { when: noRecordsBanner(), classify: 'failure', code: 'SurfaceUnavailable' },
        { when: noRecordsBanner(), classify: 'business_outcome', code: 'MEMBER_NOT_FOUND' },
      ]);
      const { result } = await run({ memberId: '00000', capability, script: { searchLeadsTo: 'noRecords' } });

      expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND' } });
    });

    it('hands a rule that asks for a person to a person, rather than calling it a defect of ours', async () => {
      const capability = withSearchRules([{ when: noRecordsBanner(), classify: 'escalate', code: 'SUPERVISOR_REVIEW' }]);
      const { result, raised } = await run({ memberId: '00000', capability, script: { searchLeadsTo: 'noRecords' }, handovers: [{ kind: 'aborted' }] });

      expect(raised.map((input) => input.reason)).toEqual(['RuleRequested']);
      expect(raised[0]?.explanation).toContain('SUPERVISOR_REVIEW');
      expect(result).toMatchObject({ status: 'escalated', intervention: { reason: 'RuleRequested', disposition: 'aborted' } });
    });

    it('fails as Internal, naming the classification, when a condition fires that no handler covers yet', async () => {
      // A step rule that asks for a person is classified, so it is not the unclassified dialog
      // case, and the result contract has no escalation reason for it. It fails as our own gap
      // rather than being quietly swallowed.
      const capability = withSearchRules([{ when: noRecordsBanner(), classify: 'escalate', code: 'SUPERVISOR_REVIEW' }]);
      const { result } = await run({ memberId: '00000', capability, script: { searchLeadsTo: 'noRecords' } });
      const failure = failureOf(result);

      expect(failure).toMatchObject({ class: 'Internal', atStepId: 'submitSearch' });
      expect(failure.observed).toContain('SUPERVISOR_REVIEW');
      expect(failure.observed).toContain('escalate');
    });
  });

  it('records drift when a lower ranked strategy finds the relabelled member ID input', async () => {
    const { result } = await run({ script: { memberLabel: 'Account Holder ID:' } });

    expect(result.status).toBe('success');
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({ describedAs: 'Member ID input', preferredKind: 'anchor-relative', winningIndex: 1 });
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { runReplayCommand } from '../../src/cli/replayCommand.js';
import { createSessionControl } from '../../src/control/controlPlane.js';
import { createSessionBroker } from '../../src/control/sessionBroker.js';
import { Capability, type CapabilityInput } from '../../src/core/capability/schema.js';
import type { ReplayResult } from '../../src/core/outcome/result.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import type { ControlToken } from '../../src/control/controlToken.js';
import type { EscalationChannel, RaiseInput } from '../../src/escalation/channel.js';
import { createFileCapabilityStore } from '../../src/evidence/capabilityStore.js';
import { replay } from '../../src/replay/executor.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// S6-T04. One test per row of docs/ERROR_TAXONOMY.md section 8, against the real application
// with the real capability. The table is the point. A reader should be able to hold section 8
// beside this file and see the same list twice.
//
// One row of the table is not here. Ambiguous locator, action needs a second matching control
// on the page, which no fault produces, and the driver contract suite proves it against this
// same Playwright driver instead. Every other row is below.

const APPROVED = 'capabilities/member.readSavingsBalance@1.1.0.json';
const WRITE = 'capabilities/member.openSubAccount@1.0.0.json';
const credentials = { username: 'operator', password: 'meridian-fixture' };

describe('the result matrix', { timeout: 180_000 }, () => {
  let server: Server;
  let base = '';
  let browser: Browser;
  let profile: AppProfile;
  let approved: CapabilityInput;
  let write: CapabilityInput;

  beforeAll(async () => {
    profile = await meridianProfile();
    approved = JSON.parse(await readFile(APPROVED, 'utf8')) as CapabilityInput;
    write = JSON.parse(await readFile(WRITE, 'utf8')) as CapabilityInput;
    const app = createTargetApp({ ...credentials, testMode: true, idSeed: 'matrix' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
  });

  beforeEach(async () => {
    await fetch(`${base}/__control__/reset`);
  });

  async function arm(fault: string, path: string, method: string | null, count = 1): Promise<void> {
    const armed = await fetch(`${base}/__control__/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault, path, ...(method === null ? {} : { method }), count }),
    });
    expect(armed.status).toBe(200);
  }

  // One replay of one capability against the live app, with a person on the other end only when
  // a row needs one.
  async function run(
    options: {
      capability?: CapabilityInput;
      memberId?: string;
      inputs?: Readonly<Record<string, string>>;
      escalation?: (issue: () => ControlToken) => EscalationChannel;
    } = {},
  ): Promise<ReplayResult> {
    const broker = createSessionBroker({
      browser,
      profile,
      allowlist: allowlistFor(base),
      baseUrl: base,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', ...credentials },
      ids: createSequentialIds(),
    });
    const grants = createGrantLedger();
    // Read off the capability rather than fixed here, because that is what src/cli/replay.ts
    // does, and the two approval rows differ only in what the artifact says about itself.
    const capability = Capability.parse(options.capability ?? approved);
    const leased = await broker.lease({
      runId: 'run_000001',
      policy: {
        phase: 'replay',
        capabilityStatus: capability.lifecycle.status,
        allowUnattendedReplay: capability.policy.allowUnattendedReplay,
        grants,
      },
    });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);
    const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId: 'run_000001', tokens: leased.lease.tokens });
    const control = session.apply('start').token;
    if (control === null) throw new Error('A started session was issued no token.');
    try {
      return await replay(capability, options.inputs ?? { memberId: options.memberId ?? '10001' }, {
        surface: leased.lease.surface,
        control,
        clock: systemClock,
        runId: 'run_000001',
        profile,
        grants,
        ...(options.escalation === undefined ? {} : { escalation: options.escalation(() => leased.lease.tokens.issue('automation')) }),
      });
    } finally {
      await leased.lease.release();
    }
  }

  // The capability with one step's declaration changed. The generalizer marks every click not
  // idempotent, which is right by default, and the app profile says GET /member/* is idempotent,
  // so a capability whose author read the profile would declare the link click repeatable.
  const withStep = (id: string, change: (step: CapabilityInput['steps'][number]) => CapabilityInput['steps'][number]): CapabilityInput => ({
    ...approved,
    steps: approved.steps.map((step) => (step.id === id ? change(step) : step)),
  });

  it('happy path returns success with typed outputs', async () => {
    const result = await run();

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.outputs).toEqual({ savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' } });
  });

  it('an unknown member is a business outcome and not a failure', async () => {
    const result = await run({ memberId: '00000' });

    expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND', terminal: true } });
  });

  it('a bad input fails as InputValidation before a browser opens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'matrix-'));
    const out: string[] = [];
    let leases = 0;
    const redactor = createRedactor({ neverPersist: ['password'], redactPatterns: [] });

    // This row is the one that never reaches a surface, so it runs through the command rather
    // than the executor. Counting the leases is what proves no browser was opened.
    const code = await runReplayCommand({
      argv: ['--capability', APPROVED, '--evidence', join(root, 'evidence')],
      readStdin: async () => '{"memberId":"abc"}',
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      store: createFileCapabilityStore({ directory: 'capabilities', redactor }),
      loadProfile: async () => ({ ok: true, profile }),
      lease: async () => {
        leases += 1;
        throw new Error('A browser was opened for inputs that do not validate.');
      },
      redactor,
      clock: systemClock,
      ids: createSequentialIds(),
      target: { baseUrl: base },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      console: { port: 0, claimTimeoutMs: 60_000, claimWindow: async () => undefined },
    });

    expect(code).toBe(1);
    expect(leases).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({ status: 'failure', failure: { class: 'InputValidation', retryable: false } });
    await rm(root, { recursive: true, force: true });
  });

  it('a permission denial is a business outcome the capability declares', async () => {
    await arm('denied', '/member/*', 'GET');
    const restricted: CapabilityInput = {
      ...approved,
      outcomes: [
        ...approved.outcomes,
        {
          code: 'ACCOUNT_RESTRICTED',
          description: 'Access to this member record is restricted.',
          terminal: true,
          detect: { kind: 'textMatches', target: { framePath: ['content'], strategies: [{ kind: 'text', text: 'Access to this record is restricted', exact: false, confidence: 0.9 }], matchPolicy: 'unique', describedAs: 'the restriction message' }, pattern: 'restricted' },
        },
      ],
    };

    const result = await run({ capability: restricted });

    expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'ACCOUNT_RESTRICTED', terminal: true } });
  });

  it('a transient 503 on an idempotent step is recovered and recorded', async () => {
    await arm('flaky503', '/member/*', 'GET', 1);
    const repeatable = withStep('clickLinkMemberId', (step) => ({ ...step, idempotent: true, retry: { attempts: 2, backoffMs: 200 } }));

    const result = await run({ capability: repeatable });

    expect(result.status).toBe('success');
    expect(result.recoveries).toEqual([{ condition: 'TransientLoad', atStepId: 'clickLinkMemberId', attempt: 1, resolved: true }]);
  });

  it('a hang fails as Timeout naming the condition it was waiting for', async () => {
    await arm('hang', '/member/*', 'GET');
    const impatient = withStep('clickLinkMemberId', (step) => ({ ...step, timeoutMs: 3_000, postcondition: { ...step.postcondition, timeoutMs: 3_000 } }));

    const result = await run({ capability: impatient });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.failure).toMatchObject({ class: 'Timeout', atStepId: 'clickLinkMemberId' });
    expect(result.failure.observed).toContain(impatient.steps[2]?.postcondition.description ?? 'nothing');

    // The held response is released so the next row does not inherit it.
    await fetch(`${base}/__control__/reset`);
  });

  it('an undeclared dialog escalates and is never clicked', async () => {
    await arm('surpriseDialog', '/servicing/search', 'POST');
    const raised: RaiseInput[] = [];
    const escalation = (): EscalationChannel => ({
      raise: async (input) => {
        raised.push(input);
        return { kind: 'aborted', interventionId: 'int_000001' };
      },
    });

    const result = await run({ memberId: '00000', capability: { ...approved, outcomes: [] }, escalation });

    expect(raised.map((input) => input.reason)).toEqual(['UnclassifiedCondition']);
    expect(result).toMatchObject({ status: 'escalated', intervention: { reason: 'UnclassifiedCondition', disposition: 'aborted' } });
  });

  it('a relabelled field is found by a lower ranked strategy and the drift is recorded', async () => {
    await arm('relabel', '/servicing/search', null, 2);

    const result = await run();

    expect(result.status).toBe('success');
    // Three strategies key on the label that moved. The one that survives anchors on the page
    // heading, which is why the bundle carries it at all.
    expect(result.drift).toHaveLength(1);
    // The preferred strategy is the label that moved, and the one that won anchors elsewhere.
    expect(result.drift[0]).toMatchObject({ preferredKind: 'label', winningKind: 'anchor-relative' });
    expect(result.drift[0]?.winningIndex).toBeGreaterThan(0);
  });

  // The write rows. A person who approves whatever they are shown, so that what each row
  // varies is whether they are asked at all and what happens after they answer.
  const approves = (): { raised: RaiseInput[]; escalation: (issue: () => ControlToken) => EscalationChannel } => {
    const raised: RaiseInput[] = [];
    return {
      raised,
      escalation: (issue) => ({
        raise: async (input) => {
          raised.push(input);
          return { kind: 'resumed', interventionId: `int_00000${raised.length}`, approved: true, token: issue() };
        },
      }),
    };
  };

  const OPEN = { memberId: '10001', accountType: 'Holiday Club', openingAmount: '250.00' };

  // What the application did, read from the application rather than from the result, because a
  // result that says nothing was posted is the thing under test.
  async function recorded(): Promise<{ submissions: unknown[]; posts: number }> {
    const state = (await (await fetch(`${base}/__control__/state`)).json()) as {
      submissions: unknown[];
      requests: { method: string; path: string }[];
    };
    return {
      submissions: state.submissions,
      posts: state.requests.filter((request) => request.method === 'POST' && request.path === '/member/10001/subaccount').length,
    };
  }

  it('a draft write stops for a person, then opens the account once on the approval they gave', async () => {
    const person = approves();

    const result = await run({ capability: write, inputs: OPEN, escalation: person.escalation });

    expect(person.raised.map((input) => input.reason)).toEqual(['PolicyConfirmation']);
    expect(person.raised[0]?.atStep?.id).toBe('clickCellOpenAccount');
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.outputs).toEqual({ suffix: { type: 'string', value: 'H01' } });
    // One approval, one submission. The grant is spent when the step runs, so the approval
    // cannot authorize a second one.
    expect(await recorded()).toEqual({ submissions: [{ memberId: '10001', accountType: 'Holiday Club', suffix: 'H01', balance: '$250.00' }], posts: 1 });
  });

  it('an approved write that allows unattended replay opens the account with nobody asked', async () => {
    const unattended: CapabilityInput = {
      ...write,
      lifecycle: { ...write.lifecycle, status: 'approved' },
      policy: { ...write.policy, allowUnattendedReplay: true },
    };
    const person = approves();

    const result = await run({ capability: unattended, inputs: OPEN, escalation: person.escalation });

    // Nobody was asked. Both halves matter, because a channel was attached and went unused.
    expect(person.raised).toEqual([]);
    expect(result.status).toBe('success');
    expect(result.interventions).toEqual([]);
    expect((await recorded()).submissions).toHaveLength(1);
  });

  it('a 503 on the submit opens nothing and does not post again, because the step is not idempotent', async () => {
    await arm('flaky503', '/member/*/subaccount', 'POST');
    const person = approves();

    const result = await run({ capability: write, inputs: OPEN, escalation: person.escalation });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.failure).toMatchObject({ class: 'SurfaceUnavailable', atStepId: 'clickCellOpenAccount', retryable: true });
    expect(result.recoveries).toEqual([]);
    // The row the retry rule exists for. The 503 fires before the application opens anything,
    // so a retry that worked would report as a recovery and be a second posted form.
    expect(await recorded()).toEqual({ submissions: [], posts: 1 });
  });

  it('an opening amount below the minimum is a business outcome carrying the field message', async () => {
    // Declared here, as the permission denial row above is, because this file exercises rows
    // rather than ships capabilities. What a review derives off the real element is proven in
    // tests/integration/reviewWrite.test.ts.
    const message = {
      framePath: ['content'],
      strategies: [{ kind: 'text' as const, text: 'The opening amount must be at least', exact: false, confidence: 0.9 }],
      matchPolicy: 'unique' as const,
      describedAs: 'the opening amount message',
    };
    const reviewed: CapabilityInput = {
      ...write,
      outcomes: [
        {
          code: 'AMOUNT_BELOW_MINIMUM',
          description: 'The opening amount is below the minimum this account type allows, so no account was opened.',
          terminal: true,
          detect: { kind: 'elementPresent', target: message },
          data: [
            {
              name: 'message',
              type: 'string',
              description: 'What the application answered when it refused the amount.',
              sensitivity: 'internal',
              required: true,
              source: { stepId: 'clickCellOpenAccount', target: message, attribute: 'text' },
            },
          ],
        },
      ],
    };
    const person = approves();

    const result = await run({ capability: reviewed, inputs: { ...OPEN, openingAmount: '5.00' }, escalation: person.escalation });

    // A person still approved the submit. The application refused it, which is an answer and
    // not a fault, and the sentence it answered with is carried as a declared field rather
    // than left for a caller to scrape out of a screenshot.
    expect(person.raised.map((input) => input.reason)).toEqual(['PolicyConfirmation']);
    expect(result).toMatchObject({ status: 'business_outcome', outcome: { code: 'AMOUNT_BELOW_MINIMUM', terminal: true } });
    if (result.status !== 'business_outcome') return;
    expect(result.outcome.data).toEqual({ message: { type: 'string', value: 'The opening amount must be at least $25.00.' } });
    expect(await recorded()).toEqual({ submissions: [], posts: 1 });
  });

  it('two rows showing the same member ID stop the run at the checkpoint that names the row', async () => {
    await arm('duplicateIds', '/servicing/search', 'POST');

    const result = await run();

    // ADR 0019. The two rows show one member number and open different records, so the
    // checkpoint that says a result row for the member is present is false rather than
    // satisfied by whichever row a lower ranked strategy happened to find.
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.failure).toMatchObject({ class: 'CheckpointFailed', atStepId: 'clickCellSearch' });
    expect(result.failure.observed).toContain('more than one element');
  });
});

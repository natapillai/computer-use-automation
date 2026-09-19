import type Anthropic from '@anthropic-ai/sdk';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { runDiscoverCommand } from '../../src/cli/discoverCommand.js';
import { createSessionControl } from '../../src/control/controlPlane.js';
import { createSessionBroker } from '../../src/control/sessionBroker.js';
import { Capability } from '../../src/core/capability/schema.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import type { ModelClient } from '../../src/discovery/modelClient.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { personAtTheConsole, type ConsolePlan } from '../fixtures/consoleOperator.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// The write thread with a person in it, and the person is a real browser on the real console.
// This is the rehearsal for the live run, and it exists because the previous rehearsal drove
// the API underneath the console and therefore proved nothing about the console.
//
// It reproduces the live failure exactly. The model goes to the member page, which is what a
// person would do, and finds nothing linking to the sub account form. It gets stuck, a person
// takes the session, sends the frame to the form by path, and hands it back. The run carries on,
// reaches the submit, stops for approval, and opens the account once.

const REQUEST = 'requests/member.openSubAccount.json';
const INPUTS = '{"memberId":"10001","accountType":"Holiday Club","openingAmount":"250.00"}';

type Turn = (text: string) => { readonly name: string; readonly input: Record<string, unknown> };

function refFor(text: string, needle: string): string {
  const line = text.split('\n').find((candidate) => candidate.includes(needle));
  const ref = line === undefined ? undefined : /\[([^\]]+)\]/.exec(line)?.[1];
  if (ref === undefined) throw new Error(`No observation line contains ${needle}.`);
  return ref;
}

function scriptedModel(turns: readonly Turn[]): ModelClient {
  let index = 0;
  return {
    next: async (request) => {
      const turn = turns[index];
      index += 1;
      if (turn === undefined) throw new Error(`The scripted model was asked for turn ${index} of ${turns.length}.`);
      const decision = turn(request.observationText ?? '');
      return {
        ok: true,
        response: {
          id: `msg_${index}`,
          type: 'message',
          role: 'assistant',
          model: 'scripted',
          content: [{ type: 'tool_use', id: `toolu_${index}`, name: decision.name, input: decision.input }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message,
      };
    },
  };
}

// What the live run actually did. The member page, then three actions that change nothing,
// which is what NoProgress is for. Once a person has put the session on the form, the same
// script drives the form, because the model is choosing from what it can see.
const STUCK_THEN_FORM: Turn[] = [
  () => ({ name: 'navigate', input: { path: '/member/{{inputs.memberId}}', framePath: ['content'] } }),
  (text) => ({ name: 'click', input: { ref: refFor(text, 'Member No:') } }),
  (text) => ({ name: 'click', input: { ref: refFor(text, 'Member No:') } }),
  (text) => ({ name: 'click', input: { ref: refFor(text, 'Member No:') } }),
  (text) => ({ name: 'select', input: { ref: refFor(text, 'combobox'), input: 'accountType' } }),
  (text) => ({ name: 'fill', input: { ref: refFor(text, 'textbox'), input: 'openingAmount' } }),
  (text) => ({ name: 'click', input: { ref: refFor(text, 'Open Account'), submits: true } }),
  // The confirmation screen if the submit ran. If a person refused it there is nothing to read,
  // so the run finishes and the generalizer is left to say why that is not a flow.
  (text) => (text.includes('H01') ? { name: 'extract', input: { ref: refFor(text, 'H01'), output: 'suffix' } } : { name: 'done', input: {} }),
  () => ({ name: 'done', input: {} }),
];

describe('the write thread with a person at the console', { timeout: 180_000 }, () => {
  let server: Server;
  let base = '';
  let browser: Browser;
  let profile: AppProfile;
  let root = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'write-thread' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    root = await mkdtemp(join(tmpdir(), 'write-thread-'));
  }, 60_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  async function submissions(): Promise<unknown> {
    const state: unknown = await (await fetch(`${base}/__control__/state`)).json();
    return Reflect.get(state as object, 'submissions');
  }

  async function discover(plans: readonly ConsolePlan[], watch?: (runDirectory: string) => Promise<void>): Promise<{ code: number; stdout: string; stderr: string; evidence: string; visits: string[] }> {
    await fetch(`${base}/__control__/reset`);
    const evidence = join(root, 'evidence');
    const out: string[] = [];
    const err: string[] = [];
    const visits: string[] = [];
    const redactor = createRedactor({ neverPersist: ['password'], redactPatterns: [] });
    let working: Promise<unknown> = Promise.resolve();
    let visited = 0;
    let runDirectory = '';

    const code = await runDiscoverCommand({
      argv: ['--request', REQUEST, '--evidence', evidence, '--capabilities', join(root, 'capabilities')],
      readStdin: async () => INPUTS,
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      // The person is handed exactly what the run prints and nothing else.
      stderr: (text) => {
        err.push(text);
        const url = /(http:\/\/\S+\/interventions\/\S+)/.exec(text)?.[1];
        if (url === undefined) return;
        const plan = plans[visited] ?? plans.at(-1);
        visited += 1;
        if (plan === undefined) return;
        working = working.then(async () => {
          if (watch !== undefined) await watch(runDirectory);
          const visit = await personAtTheConsole(browser, url, plan);
          visits.push(visit.reason);
        });
      },
      loadProfile: async () => ({ ok: true, profile }),
      lease: async ({ runId }) => {
        const broker = createSessionBroker({
          browser,
          profile,
          allowlist: allowlistFor(base),
          baseUrl: base,
          login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
          ids: createSequentialIds(),
        });
        const grants = createGrantLedger();
        const leased = await broker.lease({ runId, policy: { phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants } });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId, tokens: leased.lease.tokens });
        const control = session.apply('start').token;
        if (control === null) return { ok: false, detail: 'The session issued no token to start with.' };
        runDirectory = join(evidence, 'discovery', runId);
        return { ok: true, lease: { surface: leased.lease.surface, control, session, grants, human: leased.lease.human, release: () => leased.lease.release() } };
      },
      liveModel: () => ({ ok: true, client: scriptedModel(STUCK_THEN_FORM) }),
      modelId: 'scripted',
      redactor,
      budgets: { maxModelCalls: 16, maxActions: 16, maxDurationMs: 120_000 },
      clock: systemClock,
      ids: createSequentialIds(),
      target: { baseUrl: base },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      console: { port: 0, claimTimeoutMs: 120_000 },
    });

    await working;
    return { code, stdout: out.join(''), stderr: err.join(''), evidence, visits };
  }

  it('lets a person unstick the run from the console, then approve the write it reaches', async () => {
    const midRun: string[] = [];
    const result = await discover([
      // Stuck on the member page. The person sends the frame to the form, which is the only
      // way to reach a page nothing links to, and hands the session back.
      { work: async (session) => session.navigate('/member/10001/subaccount'), finish: 'release' },
      // At the submit. Nothing to do but decide.
      { finish: 'approve' },
    ],
    // Read while the run is paused and a person is holding it. A run killed here has to leave
    // behind what it has already done, which is the whole reason evidence is streamed.
    async (runDirectory) => {
      midRun.push(await readFile(join(runDirectory, 'trace.jsonl'), 'utf8'));
      midRun.push(await readFile(join(runDirectory, 'transcript.jsonl'), 'utf8'));
    });

    expect(midRun[0]).toContain('"t":"observation"');
    expect(midRun[0]).toContain('"t":"decision"');
    expect(midRun[1]).toContain('"observationHash"');

    expect(result.visits).toEqual(['NoProgress', 'PolicyConfirmation']);
    expect(await submissions()).toEqual([{ memberId: '10001', accountType: 'Holiday Club', suffix: 'H01', balance: '$250.00' }]);
    // Exit 1, because no capability was written. The run did what was asked and a person did
    // part of it, so there is nothing to hand a caller.
    expect(result.code).toBe(1);

    // A person took the session over, so no artifact is produced from this run. That is the
    // rule in docs/ESCALATION.md section 8, and this is the first time it has been exercised
    // against a run a person really did rescue.
    const summary = JSON.parse(result.stdout) as { status: string; capability: unknown; generalization?: { failure: string } };
    expect(summary.status).toBe('done');
    expect(summary.capability).toBeNull();
    expect(summary.generalization?.failure).toBe('HumanCompleted');

    // What they did is on the record, and the path they typed is redacted like everything else.
    const runDirectory = join(result.evidence, 'discovery');
    const runs = await readdir(runDirectory);
    const directory = join(runDirectory, runs[0] ?? '');
    const actions = await readFile(join(directory, 'humanActions.jsonl'), 'utf8');
    expect(actions).toContain('"kind":"navigate"');
    expect(actions).toContain('{{inputs.memberId}}');
    expect(actions).not.toContain('/member/10001/');

    // One image per answer, and it is the one the console had put in front of the person, not a
    // fresh capture taken afterwards. It is what says somebody looked rather than rubber
    // stamped a log line.
    const decisions = (await readdir(join(directory, 'captures'))).filter((name) => name.startsWith('decision-')).sort();
    expect(decisions).toEqual(['decision-01.png', 'decision-02.png']);
    const bytes = await readFile(join(directory, 'captures', 'decision-02.png'));
    expect(Array.from(bytes.subarray(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it('opens nothing when the person refuses the write', async () => {
    const result = await discover([{ work: async (session) => session.navigate('/member/10001/subaccount'), finish: 'release' }, { finish: 'release' }]);

    expect(await submissions()).toEqual([]);
    const summary = JSON.parse(result.stdout) as { capability: unknown; generalization?: { failure: string } };
    expect(summary.capability).toBeNull();
    // Two reasons hold here and the first one decides. This person took the session over as
    // well as refusing the write, so the run is HumanCompleted rather than WriteNotPerformed.
    // The refusal on its own is covered in discoverWrite.command.test.ts.
    expect(summary.generalization?.failure).toBe('HumanCompleted');
  });

  it('produces a capability when the person only ever approves, which is not the same as rescuing the run', async () => {
    // The same thread with the model told where the form is, which is what the request now
    // says. One intervention, one approval, and the run is the automation's own work.
    const straightToTheForm: Turn[] = [
      () => ({ name: 'navigate', input: { path: '/member/{{inputs.memberId}}/subaccount', framePath: ['content'] } }),
      ...STUCK_THEN_FORM.slice(4),
    ];
    await fetch(`${base}/__control__/reset`);
    const evidence = join(root, 'evidence-approved');
    const capabilities = join(root, 'capabilities-approved');
    const out: string[] = [];
    const err: string[] = [];
    let working: Promise<unknown> = Promise.resolve();

    const code = await runDiscoverCommand({
      argv: ['--request', REQUEST, '--evidence', evidence, '--capabilities', capabilities],
      readStdin: async () => INPUTS,
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      stderr: (text) => {
        err.push(text);
        const url = /(http:\/\/\S+\/interventions\/\S+)/.exec(text)?.[1];
        if (url === undefined) return;
        working = working.then(() => personAtTheConsole(browser, url, { finish: 'approve' }));
      },
      loadProfile: async () => ({ ok: true, profile }),
      lease: async ({ runId }) => {
        const broker = createSessionBroker({
          browser,
          profile,
          allowlist: allowlistFor(base),
          baseUrl: base,
          login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
          ids: createSequentialIds(),
        });
        const grants = createGrantLedger();
        const leased = await broker.lease({ runId, policy: { phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants } });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId, tokens: leased.lease.tokens });
        const control = session.apply('start').token;
        if (control === null) return { ok: false, detail: 'The session issued no token to start with.' };
        return { ok: true, lease: { surface: leased.lease.surface, control, session, grants, human: leased.lease.human, release: () => leased.lease.release() } };
      },
      liveModel: () => ({ ok: true, client: scriptedModel(straightToTheForm) }),
      modelId: 'scripted',
      redactor: createRedactor({ neverPersist: ['password'], redactPatterns: [] }),
      budgets: { maxModelCalls: 16, maxActions: 16, maxDurationMs: 120_000 },
      clock: systemClock,
      ids: createSequentialIds(),
      target: { baseUrl: base },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      console: { port: 0, claimTimeoutMs: 120_000 },
    });
    await working;

    expect(code, err.join('')).toBe(0);
    const summary = JSON.parse(out.join('')) as { capability: { id: string; version: string; path: string } | null };
    expect(summary.capability).toMatchObject({ id: 'member.openSubAccount', version: '1.0.0' });
    if (summary.capability === null) return;

    const capability = Capability.parse(JSON.parse(await readFile(summary.capability.path, 'utf8')));
    expect(capability.policy.maxEffect).toBe('write');
    expect(capability.steps.map((step) => [step.action.kind, step.effect, step.idempotent])).toEqual([
      ['navigate', 'read', true],
      ['select', 'read', true],
      ['fill', 'read', true],
      ['click', 'write', false],
    ]);
    expect(await submissions()).toEqual([{ memberId: '10001', accountType: 'Holiday Club', suffix: 'H01', balance: '$250.00' }]);
  });
});

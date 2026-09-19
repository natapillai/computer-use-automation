import type Anthropic from '@anthropic-ai/sdk';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { handleIntervention } from '../fixtures/mockOperator.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// The write thread end to end through the discover command, with everything real except the
// model. A run that may write is offered the submits flag, the declared action stops at the
// console, a person approves it over HTTP, the run performs it once and carries on to the
// confirmation screen, and what comes out is a capability whose step says it writes.
//
// The model is scripted here only so this can run offline and for free. The live run is the
// same path with the same request, which is the point of testing it this way.

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

const SCRIPT: Turn[] = [
  // Straight to the form by path. The member page carries no link to it, and following one
  // would make the capability depend on a page it never needs to read.
  () => ({ name: 'navigate', input: { path: '/member/{{inputs.memberId}}/subaccount', framePath: ['content'] } }),
  (text) => ({ name: 'select', input: { ref: refFor(text, 'combobox'), input: 'accountType' } }),
  (text) => ({ name: 'fill', input: { ref: refFor(text, 'textbox'), input: 'openingAmount' } }),
  (text) => ({ name: 'click', input: { ref: refFor(text, 'Open Account'), submits: true } }),
  // The confirmation screen if the submit ran, and otherwise there is nothing to read, so the
  // run finishes without an output and the generalizer is left to say why that is not a flow.
  (text) => (text.includes('H01') ? { name: 'extract', input: { ref: refFor(text, 'H01'), output: 'suffix' } } : { name: 'done', input: {} }),
  () => ({ name: 'done', input: {} }),
];

describe('discovering the write flow through the command', { timeout: 120_000 }, () => {
  let server: Server;
  let base = '';
  let browser: Browser;
  let profile: AppProfile;
  let root = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'discover-write-cli' });
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
    root = await mkdtemp(join(tmpdir(), 'discover-write-'));
    await fetch(`${base}/__control__/reset`);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function discover(approve: boolean): Promise<{ code: number; stdout: string; stderr: string; submissions: unknown }> {
    const evidence = join(root, 'evidence');
    const capabilities = join(root, 'capabilities');
    const out: string[] = [];
    const err: string[] = [];
    const redactor = createRedactor({ neverPersist: ['password'], redactPatterns: [] });
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
        working = working.then(() => handleIntervention(url, { finish: { release: true, approve } }));
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
      liveModel: () => ({ ok: true, client: scriptedModel(SCRIPT) }),
      modelId: 'scripted',
      redactor,
      budgets: { maxModelCalls: 12, maxActions: 12, maxDurationMs: 90_000 },
      clock: systemClock,
      ids: createSequentialIds(),
      target: { baseUrl: base },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      console: { port: 0, claimTimeoutMs: 60_000 },
    });

    await working;
    const state: unknown = await (await fetch(`${base}/__control__/state`)).json();
    return { code, stdout: out.join(''), stderr: err.join(''), submissions: Reflect.get(state as object, 'submissions') };
  }

  it('stops at the submit, opens the account once a person approves, and writes a capability that says it writes', async () => {
    const { code, stdout, stderr, submissions } = await discover(true);

    expect(stderr).toContain('A person is needed.');
    expect(code, stderr).toBe(0);
    expect(submissions).toEqual([{ memberId: '10001', accountType: 'Holiday Club', suffix: 'H01', balance: '$250.00' }]);

    const summary = JSON.parse(stdout) as { capability: { id: string; version: string } | null };
    expect(summary.capability).toMatchObject({ id: 'member.openSubAccount', version: '1.0.0' });
    if (summary.capability === null) return;

    const capability = Capability.parse(JSON.parse(await readFile(join(root, 'capabilities', `${summary.capability.id}@${summary.capability.version}.json`), 'utf8')));
    expect(capability.policy.maxEffect).toBe('write');
    expect(capability.steps.map((step) => [step.action.kind, step.effect, step.idempotent])).toEqual([
      ['navigate', 'read', true],
      ['select', 'read', true],
      ['fill', 'read', true],
      ['click', 'write', false],
    ]);
    expect(capability.outputs.map((output) => output.name)).toEqual(['suffix']);

    // The whole thread is on the record, including the screen the person was shown.
    const files = (await readdir(join(root, 'evidence'), { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
    expect(files).toContain('intervention-01.png');
    expect(files).toContain('intervention-01.a11y.json');
    expect(files).toContain('artifact.json');
  });

  it('opens nothing and writes no capability when the person declines', async () => {
    const { submissions, stdout, code } = await discover(false);

    expect(submissions).toEqual([]);
    // The run finished, and a flow whose write was refused is not a capability. Saying so is
    // the difference between an artifact that works and one that stops a step short.
    const summary = JSON.parse(stdout) as { capability: unknown; generalization?: { failure: string } };
    expect(summary.capability).toBeNull();
    expect(summary.generalization?.failure).toBe('WriteNotPerformed');
    expect(code).toBe(1);
  });
});

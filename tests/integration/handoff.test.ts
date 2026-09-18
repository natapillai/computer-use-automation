import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionControl } from '../../src/control/controlPlane.js';
import { createSessionBroker } from '../../src/control/sessionBroker.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { runReplayCommand } from '../../src/cli/replayCommand.js';
import { createFileCapabilityStore } from '../../src/evidence/capabilityStore.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { handleIntervention, type HandledIntervention, type OperatorPlan } from '../fixtures/mockOperator.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// S5-T07. The whole handoff cycle against the real application, driven end to end by the replay
// command, with a headless operator that has nothing but the URL the run printed. A modal
// nobody declared stops the run, a person takes the live session, clicks the thing the
// automation was not allowed to touch, hands it back, and the run finishes on the same session.
//
// This is requirement 3.6. Everything before it proves the pieces. This proves the round trip.
//
// The capability under test is the 1.0.0 draft, and the member searched for does not exist.
// That is why the modal stops the run at all. With nothing on the page the draft can read, no
// contender wins the race, so the only thing left is a dialog nobody has classified. The 1.1.0
// review closed exactly this hole, and replaying 1.1.0 on the same page returns MEMBER_NOT_FOUND
// with nobody involved, which is the pair worth having.

const CAPABILITY = 'capabilities/member.readSavingsBalance@1.0.0.json';

interface BoxedNode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly framePath: readonly string[];
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly children: readonly BoxedNode[];
}

function walk(node: BoxedNode): BoxedNode[] {
  return [node, ...node.children.flatMap(walk)];
}

// Where a person would click, worked out from the snapshot the intervention points at. A
// console works in page space, so the frame origin is added to the frame relative box.
function pointOf(root: BoxedNode, name: string): { x: number; y: number } {
  const nodes = walk(root);
  const target = nodes.find((node) => node.name.replace(/\s+/g, ' ').trim() === name && node.framePath.join('/') === 'content');
  const frame = nodes.find((node) => node.role === 'iframe' && node.framePath.length === 0 && walk(node).some((child) => child.framePath.join('/') === 'content'));
  if (target === undefined || frame === undefined) throw new Error(`The captured screen has no ${name} inside the content frame.`);
  return { x: frame.box.x + target.box.x + target.box.width / 2, y: frame.box.y + target.box.y + target.box.height / 2 };
}

describe('the full handoff cycle', { timeout: 120_000 }, () => {
  let server: Server;
  let base = '';
  let browser: Browser;
  let profile: AppProfile;
  let evidence = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'handoff' });
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
    evidence = await mkdtemp(join(tmpdir(), 'handoff-'));
  });
  afterEach(() => rm(evidence, { recursive: true, force: true }));

  async function runWithOperator(plan: (context: { readonly runDirectory: string; readonly handoff: number }) => OperatorPlan): Promise<{
    code: number;
    stdout: string;
    stderr: string;
    handled: HandledIntervention[];
  }> {
    await fetch(`${base}/__control__/reset`);
    await fetch(`${base}/__control__/fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fault: 'surpriseDialog', path: '/servicing/search', method: 'POST', count: 1 }),
    });

    const out: string[] = [];
    const err: string[] = [];
    const redactor = createRedactor({ neverPersist: ['password'], redactPatterns: [] });
    const handled: HandledIntervention[] = [];
    let working: Promise<unknown> = Promise.resolve();
    let runDirectory = '';
    let handoff = 0;

    const code = await runReplayCommand({
      argv: ['--capability', CAPABILITY, '--evidence', evidence],
      readStdin: async () => '{"memberId":"00000"}',
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      // The only thing the operator is given is the line the run printed, which is what a
      // person on call would be handed.
      stderr: (text) => {
        err.push(text);
        const url = /(http:\/\/\S+\/interventions\/\S+)/.exec(text)?.[1];
        if (url === undefined) return;
        handoff += 1;
        const which = handoff;
        // Chained, so a run that asks twice gets one person at a time rather than two at once.
        working = working.then(async () => {
          handled.push(await handleIntervention(url, plan({ runDirectory, handoff: which })));
        });
      },
      store: createFileCapabilityStore({ directory: 'capabilities', redactor }),
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
        const leased = await broker.lease({ runId, policy: { phase: 'replay', capabilityStatus: 'approved', allowUnattendedReplay: false, grants } });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId, tokens: leased.lease.tokens });
        const control = session.apply('start').token;
        if (control === null) return { ok: false, detail: 'The session issued no token to start with.' };
        runDirectory = join(evidence, 'replay', runId);
        return { ok: true, lease: { surface: leased.lease.surface, control, session, grants, human: leased.lease.human, release: () => leased.lease.release() } };
      },
      redactor,
      clock: systemClock,
      ids: createSequentialIds(),
      target: { baseUrl: base },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      console: { port: 0, claimTimeoutMs: 60_000 },
    });

    await working;
    return { code, stdout: out.join(''), stderr: err.join(''), handled };
  }

  it('hands the live session over, takes a click from the person, and ends honestly when the page still cannot answer', async () => {
    const { code, stdout, stderr, handled } = await runWithOperator(({ runDirectory, handoff }) => ({
      work:
        handoff > 1
          ? undefined
          : async (session) => {
              // A person looks first. The screenshot is the masked one, which is the only kind
              // that exists anywhere in this system.
              const shot = await session.screenshot();
              expect(shot.byteLength).toBeGreaterThan(0);

              const snapshot: unknown = JSON.parse(await readFile(join(runDirectory, 'captures/intervention-01.a11y.json'), 'utf8'));
              const root = Reflect.get(snapshot as object, 'root') as BoxedNode;
              await session.click(pointOf(root, 'OK'));
            },
      finish: { release: true },
    }));

    const result = JSON.parse(stdout) as {
      status: string;
      failure?: { class: string; observed: string };
      interventions: { reason: string; disposition: string }[];
    };
    expect(stderr).toContain('A person is needed.');

    // The person took the live session, cleared the modal, and gave it back. The draft still
    // has no way to read an empty result, so the run asks again, and stops asking after three
    // tries because a handoff that keeps coming back is a loop and not an escalation.
    expect(result.interventions.map((episode) => [episode.reason, episode.disposition])).toEqual([
      ['UnclassifiedCondition', 'resumed'],
      ['resumePreconditionFailed', 'resumed'],
      ['resumePreconditionFailed', 'resumed'],
    ]);
    // Nobody refused anything. The step simply has nothing to run against.
    expect(result.status).toBe('failure');
    expect(result.failure?.class).toBe('PreconditionFailed');
    expect(code).toBe(1);
    expect(handled[0]).toMatchObject({ interventionId: 'int_000002', screenshots: 1 });

    // The intervention carried a screen and a tree, and what the person did is on the record.
    const directory = join(evidence, 'replay', 'failure', 'run_000001');
    const files = (await readdir(directory, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
    expect(files).toContain('intervention-01.png');
    expect(files).toContain('intervention-01.a11y.json');
    const actions = await readFile(join(directory, 'humanActions.jsonl'), 'utf8');
    expect(actions).toContain('"kind":"click"');
    expect(actions).toContain('OK');
  });

  it('ends the run at once when the person refuses it, and says how the session ended', async () => {
    const { code, stdout } = await runWithOperator(() => ({ finish: { abort: true } }));

    const result: unknown = JSON.parse(stdout);
    expect(code).toBe(3);
    expect(result).toMatchObject({ status: 'escalated', intervention: { reason: 'UnclassifiedCondition', disposition: 'aborted' } });
  });
});

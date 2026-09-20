import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profile, allowlist, redactor } from '../../tests/fixtures/discovery/fakeRun.js';
import { readSavingsBalanceFixture } from '../../tests/fixtures/capabilities/readSavingsBalance.js';
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createSessionControl } from '../control/controlPlane.js';
import { createControlTokens } from '../control/controlToken.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createFileCapabilityStore } from '../evidence/capabilityStore.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { looksLikeMachinePath } from './paths.js';
import { runReplayCommand } from './replayCommand.js';

// The replay command on the scripted app. The bin only wires a real browser into these deps,
// and tests/e2e/replay.cli.test.ts runs that bin against the live app.

interface Setup {
  readonly script?: MeridianScriptOptions;
  readonly extraArgs?: readonly string[];
  readonly argv?: (paths: { capability: string; evidence: string }) => readonly string[];
  readonly stdin?: string | null | 'untouchable';
}

// Every string a caller could paste into a ticket, wherever it sits in the payload. A line
// check is not enough, because a pretty printed path sits behind its key and a regex anchored
// at the start of the line never sees it.
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('runReplayCommand', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'replay-cli-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function run(setup: Setup = {}) {
    const store = createFileCapabilityStore({ directory: join(root, 'capabilities'), redactor });
    const written = await store.write(readSavingsBalanceFixture(), { inputValues: {} });
    if (!written.ok) throw new Error(`The fixture was not written. ${written.detail}`);
    const paths = { capability: written.path, evidence: join(root, 'evidence') };

    const clock = createTestClock('2026-09-15T09:00:00.000Z');
    let leases = 0;
    const out: string[] = [];
    const err: string[] = [];
    const code = await runReplayCommand({
      argv: setup.argv?.(paths) ?? ['--capability', paths.capability, '--evidence', paths.evidence, ...(setup.extraArgs ?? [])],
      readStdin: async () => {
        if (setup.stdin === 'untouchable') throw new Error('stdin was read although --inputs was given.');
        return setup.stdin === undefined ? '{"memberId":"10001"}' : setup.stdin;
      },
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      store,
      loadProfile: async () => ({ ok: true, profile }),
      lease: async ({ runId }) => {
        leases += 1;
        const tokens = createControlTokens('sess_000001', createSequentialIds());
        const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(setup.script), clock });
        const grants = createGrantLedger();
        const surface = createGuardedSurface({
          driver,
          policy: { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants },
          runId,
          baseUrl: 'http://localhost:4010',
        });
        const session = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock, runId, tokens });
        const control = session.apply('start').token;
        if (control === null) throw new Error('A started session was issued no token.');
        return { ok: true, lease: { surface, control, session, grants, release: async () => undefined } };
      },
      redactor,
      clock,
      ids: createSequentialIds(),
      target: { baseUrl: 'http://localhost:4010' },
      environment: { driver: 'fake', driverVersion: '1.0.0' },
      // Port 0, so every run in this suite binds a free port of its own.
      // Nobody is coming, and nothing here waits to find that out.
      console: { port: 0, claimTimeoutMs: 60_000, claimWindow: async () => undefined },
    });
    return { code, stdout: out.join(''), stderr: err.join(''), leases, paths };
  }

  async function evidenceText(directory: string): Promise<{ files: string[]; text: string }> {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
    const texts = await Promise.all(files.filter((file) => !file.endsWith('.png')).map((file) => readFile(file, 'utf8')));
    return { files: files.map((file) => file.slice(directory.length + 1).split('\\').join('/')).sort(), text: texts.join('\n') };
  }

  it('prints the caller projection with the real balance and exits 0 on success', async () => {
    const { code, stdout, stderr } = await run();

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD' } } });
    expect(stderr).toBe('');
  });

  it('prints no machine path, because what it prints gets pasted into a ticket', async () => {
    const { stdout, stderr, paths } = await run();

    expect(looksLikeMachinePath(paths.capability)).toBe(true);
    expect(looksLikeMachinePath(paths.evidence)).toBe(true);
    for (const found of strings(JSON.parse(stdout))) expect(looksLikeMachinePath(found), found).toBe(false);
    for (const given of [paths.capability, paths.evidence, root]) {
      expect(stdout).not.toContain(given);
      expect(stderr).not.toContain(given);
    }
  });

  it('files the evidence under the outcome of the run and holds neither the member id nor the balance', async () => {
    const { paths } = await run();
    const evidence = await evidenceText(paths.evidence);

    expect(evidence.files).toEqual(['replay/success/run_000001/log.jsonl', 'replay/success/run_000001/manifest.json']);
    expect(evidence.text).not.toMatch(/10001|4,250\.75|425075/);
    expect(evidence.text).toContain('"status": "success"');
    // The lifecycle the run replayed under, so an approved run reads differently from a draft.
    expect(evidence.text).toContain('"capability":{"id":"member.readSavingsBalance","version":"1.0.0","status":"draft"}');
  });

  it('gives the sink the supplied inputs, so everything it writes is templated and not just pattern matched', async () => {
    // Discovery and review both register provenance and replay did not, so a member id the
    // caller supplied survived into anything the sink wrote that the result projection does
    // not own. A five digit id matches no pattern, so patterns were never going to catch it.
    // Found by the canary scanner on a failure capture, which is the first replay artifact
    // to carry a page URL.
    // A failure on the member detail screen, whose frame URL carries the member id the caller
    // supplied, which is the shape the scanner caught. The balance is unreadable as money, so
    // the run gets that far and then cannot produce its output.
    const { paths } = await run({ script: { balance: 'see teller' } });
    const evidence = await evidenceText(paths.evidence);

    expect(evidence.files).toContain('replay/failure/run_000001/captures/failure.a11y.json');
    expect(evidence.text).toContain('/member/{{inputs.memberId}}');
    expect(evidence.text).not.toContain('10001');
  });

  it('files a business outcome and a failure in their own directories, so evidence reads by outcome', async () => {
    const outcome = await run({ script: { searchLeadsTo: 'noRecords', memberId: '00000' }, stdin: '{"memberId":"00000"}' });
    const failure = await run({ script: { searchLeadsTo: 'wrongPage' } });

    // Both runs share one evidence root here, which is also how the two directories are proven
    // not to collide when two runs carry the same run id.
    expect([outcome.code, failure.code]).toEqual([0, 1]);
    // A failure carries the screen and the tree it failed on. A structured result says what
    // was expected and what was observed, and the capture is what lets somebody who was not
    // there see the page that produced it. A business outcome is an answer, not a defect, so
    // it gets no capture and stays cheap.
    expect((await evidenceText(failure.paths.evidence)).files).toEqual([
      'replay/businessOutcome/run_000001/log.jsonl',
      'replay/businessOutcome/run_000001/manifest.json',
      'replay/failure/run_000001/captures/failure.a11y.json',
      'replay/failure/run_000001/captures/failure.png',
      'replay/failure/run_000001/log.jsonl',
      'replay/failure/run_000001/manifest.json',
    ]);
  });

  it('exits 0 with a typed business outcome, because no such member is not a failure', async () => {
    const { code, stdout } = await run({ script: { searchLeadsTo: 'noRecords', memberId: '00000' }, stdin: '{"memberId":"00000"}' });

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND' } });
  });

  it('exits 1 with valid JSON when the run fails', async () => {
    const { code, stdout } = await run({ script: { searchLeadsTo: 'wrongPage' } });

    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'failure' });
  });

  it('rejects invalid inputs as a typed failure before any session is leased', async () => {
    const { code, stdout, leases } = await run({ stdin: '{"memberId":"abc"}' });

    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'failure', failure: { class: 'InputValidation', atStepId: null } });
    expect(leases).toBe(0);
  });

  it('reads inputs from the file named by --inputs and never touches stdin', async () => {
    await writeFile(join(root, 'inputs.json'), '{"memberId":"10001"}');

    const { code } = await run({ extraArgs: ['--inputs', join(root, 'inputs.json')], stdin: 'untouchable' });

    expect(code).toBe(0);
  });

  it('refuses inputs passed as arguments without repeating them, and leases nothing', async () => {
    const { code, stdout, stderr, leases } = await run({ extraArgs: ['--memberId', '10001'] });

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).not.toContain('10001');
    expect(stderr).not.toBe('');
    expect(leases).toBe(0);
  });

  it('refuses to run when nothing is piped and no --inputs is given', async () => {
    const { code, leases } = await run({ stdin: null });

    expect(code).toBe(2);
    expect(leases).toBe(0);
  });

  it('reports a capability it cannot read as a usage error', async () => {
    const { code, leases, stderr } = await run({ argv: (paths) => ['--capability', join(root, 'missing@1.0.0.json'), '--evidence', paths.evidence] });

    expect(code).toBe(2);
    expect(stderr).toContain('no capability file');
    expect(leases).toBe(0);
  });
});

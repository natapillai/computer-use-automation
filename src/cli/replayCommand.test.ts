import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profile, allowlist, redactor } from '../../tests/fixtures/discovery/fakeRun.js';
import { readSavingsBalanceFixture } from '../../tests/fixtures/capabilities/readSavingsBalance.js';
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createControlTokens } from '../control/controlToken.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createFileCapabilityStore } from '../evidence/capabilityStore.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { runReplayCommand } from './replayCommand.js';

// The replay command on the scripted app. The bin only wires a real browser into these deps,
// and tests/e2e/replay.cli.test.ts runs that bin against the live app.

interface Setup {
  readonly script?: MeridianScriptOptions;
  readonly extraArgs?: readonly string[];
  readonly argv?: (paths: { capability: string; evidence: string }) => readonly string[];
  readonly stdin?: string | null | 'untouchable';
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
        const surface = createGuardedSurface({
          driver,
          policy: { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() },
          runId,
          baseUrl: 'http://localhost:4010',
        });
        return { ok: true, lease: { surface, control: tokens.issue('automation'), release: async () => undefined } };
      },
      redactor,
      clock,
      ids: createSequentialIds(),
      target: { baseUrl: 'http://localhost:4010' },
      environment: { driver: 'fake', driverVersion: '1.0.0' },
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

  it('writes a manifest and a log that hold neither the member id nor the balance', async () => {
    const { paths } = await run();
    const evidence = await evidenceText(paths.evidence);

    expect(evidence.files).toEqual(['replay/run_000001/log.jsonl', 'replay/run_000001/manifest.json']);
    expect(evidence.text).not.toMatch(/10001|4,250\.75|425075/);
    expect(evidence.text).toContain('"status": "success"');
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

import { readFileSync } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowlist, profile } from '../../tests/fixtures/discovery/fakeRun.js';
import { meridianScript, type MeridianScriptOptions } from '../../tests/fixtures/surface/meridianScreens.js';
import { createSessionControl } from '../control/controlPlane.js';
import { createControlTokens } from '../control/controlToken.js';
import { Capability } from '../core/capability/schema.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { canariesFromSeed, scanDirectories } from '../evidence/scanner.js';
import { createFileCapabilityStore } from '../evidence/capabilityStore.js';
import { loadAllowlist } from '../runtime/allowlist.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { runReviewCommand } from './reviewCommand.js';

// The negative probe review on the scripted app, ADR 0018. The draft under review is the one the
// generalizer produces from a discovery run, which declares no outcomes at all.

const DECISION = { code: 'MEMBER_NOT_FOUND', description: 'No member exists with the supplied ID.', terminal: true, elementText: 'No records found.' };

function draft(): unknown {
  return JSON.parse(readFileSync(new URL('../../tests/fixtures/discovery/expectedDraft.json', import.meta.url), 'utf8'));
}

interface Paths {
  readonly capability: string;
  readonly decision: string;
  readonly evidence: string;
}

interface Setup {
  readonly script?: MeridianScriptOptions;
  readonly decision?: Partial<typeof DECISION>;
  readonly extraArgs?: readonly string[];
  readonly argv?: (paths: Paths) => readonly string[];
  readonly stdin?: string;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).split('\\').join('/'))
    .sort();
}

describe('runReviewCommand', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'review-cli-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function run(setup: Setup = {}) {
    const loaded = await loadAllowlist('policy/allowlist.yaml');
    if (!loaded.ok) throw new Error(loaded.message);
    const redactor = createRedactor(loaded.allowlist.data);
    const written = await createFileCapabilityStore({ directory: join(root, 'capabilities'), redactor }).write(draft(), { inputValues: {} });
    if (!written.ok) throw new Error(`The draft was not written. ${written.detail}`);

    const paths: Paths = { capability: written.path, decision: join(root, 'decision.json'), evidence: join(root, 'evidence') };
    await writeFile(paths.decision, JSON.stringify({ ...DECISION, ...setup.decision }));

    const clock = createTestClock('2026-09-16T09:00:00.000Z');
    const out: string[] = [];
    const err: string[] = [];
    let leases = 0;
    const code = await runReviewCommand({
      argv: setup.argv?.(paths) ?? ['--capability', paths.capability, '--decision', paths.decision, '--evidence', paths.evidence, ...(setup.extraArgs ?? [])],
      readStdin: async () => setup.stdin ?? '{"memberId":"00000"}',
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      makeStore: (directory) => createFileCapabilityStore({ directory, redactor }),
      loadProfile: async () => ({ ok: true, profile }),
      lease: async ({ runId }) => {
        leases += 1;
        const tokens = createControlTokens(`sess_${leases}`, createSequentialIds());
        const driver = createFakeSurfaceDriver({
          sessionId: `sess_${leases}`,
          control: tokens,
          script: meridianScript({ searchLeadsTo: 'noRecords', memberId: '00000', ...setup.script }),
          clock,
        });
        const grants = createGrantLedger();
        const surface = createGuardedSurface({
          driver,
          policy: { allowlist, phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants },
          runId,
          baseUrl: 'http://localhost:4010',
        });
        const session = createSessionControl({ sessionId: `sess_${leases}`, ids: createSequentialIds(), clock, runId, tokens });
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
      console: { port: 0, claimTimeoutMs: 60_000 },
    });
    return { code, stdout: out.join(''), stderr: err.join(''), leases, paths, patterns: loaded.allowlist.data.redactPatterns };
  }

  it('derives the outcome from the banner, verifies it by replaying, and writes 1.1.0 beside the draft', async () => {
    const { code, stdout, stderr, paths } = await run();

    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      status: 'declared',
      code: 'MEMBER_NOT_FOUND',
      capability: { id: 'member.readSavingsBalance', version: '1.1.0' },
      probe: { status: 'failure', atStepId: 'clickCellSearch' },
      verification: { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' },
    });

    const reviewed = Capability.parse(JSON.parse(await readFile(join(dirname(paths.capability), 'member.readSavingsBalance@1.1.0.json'), 'utf8')));
    expect(reviewed.outcomes).toMatchObject([{ code: 'MEMBER_NOT_FOUND', terminal: true, provenance: 'manual', detect: { kind: 'elementPresent' } }]);
    expect(reviewed.provenance.derivedFrom).toEqual({ id: 'member.readSavingsBalance', version: '1.0.0' });
  });

  it('writes the probe evidence, including the diff between the two versions', async () => {
    const { paths, patterns } = await run();

    expect(await filesUnder(paths.evidence)).toEqual([
      'review/run_000001/artifact.diff.json',
      'review/run_000001/captures/stop.a11y.json',
      'review/run_000001/captures/stop.png',
      'review/run_000001/log.jsonl',
      'review/run_000001/manifest.json',
    ]);
    const diff: unknown = JSON.parse(await readFile(join(paths.evidence, 'review', 'run_000001', 'artifact.diff.json'), 'utf8'));
    expect(diff).toMatchObject({ from: '1.0.0', to: '1.1.0', changes: expect.arrayContaining([{ path: 'version', kind: 'changed', before: '1.0.0', after: '1.1.0' }]) });

    const scan = await scanDirectories(root, ['evidence', 'capabilities'], { canaries: await canariesFromSeed('apps/target/seed.json'), patterns });
    expect(scan.hits).toEqual([]);
  });

  it('refuses to declare anything when the probe input does not stop the run', async () => {
    const { code, stdout, paths } = await run({ script: { searchLeadsTo: 'results', memberId: '10001' }, stdin: '{"memberId":"10001"}' });

    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'refused', reason: 'ProbeDidNotStop', probe: { status: 'success' } });
    await expect(access(join(dirname(paths.capability), 'member.readSavingsBalance@1.1.0.json'))).rejects.toThrow();
  });

  it('refuses when the text the reviewer names is on nothing, and never repeats it', async () => {
    const { code, stdout, stderr, paths } = await run({ decision: { elementText: 'Test Member One' } });

    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'refused', reason: 'NoMatchingElement' });
    expect(`${stdout}${stderr}`).not.toContain('Test Member One');
    await expect(access(join(dirname(paths.capability), 'member.readSavingsBalance@1.1.0.json'))).rejects.toThrow();
  });

  it('approves a draft in place when a reviewer signs it off, and leases nothing', async () => {
    const { code, stdout, leases, paths } = await run({ argv: (p) => ['--capability', p.capability, '--approve', 'operator-7'] });

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'approved', capability: { id: 'member.readSavingsBalance', version: '1.0.0' }, approvedBy: 'operator-7' });
    expect(leases).toBe(0);
    const approved = Capability.parse(JSON.parse(await readFile(paths.capability, 'utf8')));
    expect(approved.lifecycle).toEqual({ status: 'approved', approvedBy: 'operator-7', approvedAt: '2026-09-16T09:00:00.000Z' });
  });

  it('refuses probe inputs passed as arguments and an unreadable decision, before any session', async () => {
    const onArgv = await run({ extraArgs: ['--memberId', '00000'] });
    const missing = await run({ argv: (p) => ['--capability', p.capability, '--decision', join(root, 'missing.json'), '--evidence', p.evidence] });

    expect([onArgv.code, onArgv.stdout, onArgv.leases]).toEqual([2, '', 0]);
    expect(onArgv.stderr).not.toContain('00000');
    expect([missing.code, missing.leases]).toEqual([2, 0]);
  });
});

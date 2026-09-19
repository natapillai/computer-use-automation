import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowlist, call, GOAL, happyPathTurns, profile } from '../../tests/fixtures/discovery/fakeRun.js';
import { meridianScript } from '../../tests/fixtures/surface/meridianScreens.js';
import { createSessionControl } from '../control/controlPlane.js';
import { createControlTokens } from '../control/controlToken.js';
import { createGrantLedger } from '../core/policy/authorize.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { Cassette } from '../discovery/cassetteModelClient.js';
import { createFakeModelClient, type FakeModelClient, type FakeTurn } from '../discovery/fakeModelClient.js';
import { canariesFromSeed, scanDirectories } from '../evidence/scanner.js';
import { loadAllowlist } from '../runtime/allowlist.js';
import { createTestClock } from '../runtime/clock.js';
import { createSequentialIds } from '../runtime/ids.js';
import { createFakeSurfaceDriver } from '../surface/fake/fakeSurfaceDriver.js';
import { createGuardedSurface } from '../surface/guardedSurface.js';
import { runDiscoverCommand } from './discoverCommand.js';
import { looksLikeMachinePath } from './paths.js';

// The discover command on the scripted app with a scripted model. The redactor is built from
// the committed allowlist and everything written is scanned for the seeded canaries, so this
// is the same check the committed evidence of the live run must pass.

const REQUEST = {
  id: 'member.readSavingsBalance',
  name: 'Read member savings balance',
  description: 'Looks up a member by ID and returns the current balance of their primary savings account.',
  goal: GOAL,
  app: { appId: 'meridian-core', vendor: 'meridian', entryPath: '/servicing' },
  inputs: [{ name: 'memberId', type: 'string', required: true, sensitivity: 'pii', description: 'Institution member number', constraints: { pattern: '^[0-9]{5,10}$' } }],
};

interface Paths {
  readonly request: string;
  readonly evidence: string;
  readonly capabilities: string;
}

interface Setup {
  readonly request?: Record<string, unknown>;
  readonly turns?: readonly FakeTurn[];
  readonly extraArgs?: readonly string[];
  readonly argv?: (paths: Paths) => readonly string[];
  readonly modelId?: string | null;
  readonly liveModel?: 'unavailable' | 'forbidden';
  readonly stdin?: string;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).split('\\').join('/'))
    .sort();
}

describe('runDiscoverCommand', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'discover-cli-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function run(setup: Setup = {}) {
    const loaded = await loadAllowlist('policy/allowlist.yaml');
    if (!loaded.ok) throw new Error(loaded.message);
    const paths: Paths = { request: join(root, 'request.json'), evidence: join(root, 'evidence'), capabilities: join(root, 'capabilities') };
    await writeFile(paths.request, JSON.stringify(setup.request ?? REQUEST));

    const clock = createTestClock('2026-09-15T09:00:00.000Z');
    const out: string[] = [];
    const err: string[] = [];
    let leases = 0;
    let model: FakeModelClient | undefined;
    const code = await runDiscoverCommand({
      argv: setup.argv?.(paths) ?? ['--request', paths.request, '--evidence', paths.evidence, '--capabilities', paths.capabilities, ...(setup.extraArgs ?? [])],
      readStdin: async () => setup.stdin ?? '{"memberId":"10001"}',
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      loadProfile: async () => ({ ok: true, profile }),
      lease: async ({ runId }) => {
        leases += 1;
        const tokens = createControlTokens('sess_000001', createSequentialIds());
        const driver = createFakeSurfaceDriver({ sessionId: 'sess_000001', control: tokens, script: meridianScript(), clock });
        const grants = createGrantLedger();
        const surface = createGuardedSurface({
          driver,
          policy: { allowlist, phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants },
          runId,
          baseUrl: 'http://localhost:4010',
        });
        const session = createSessionControl({ sessionId: 'sess_000001', ids: createSequentialIds(), clock, runId, tokens });
        const control = session.apply('start').token;
        if (control === null) throw new Error('A started session was issued no token.');
        return { ok: true, lease: { surface, control, session, grants, release: async () => undefined } };
      },
      liveModel: () => {
        if (setup.liveModel === 'forbidden') throw new Error('A live model was built for a run that names a cassette.');
        if (setup.liveModel === 'unavailable') return { ok: false, message: 'Invalid environment. ANTHROPIC_API_KEY is required for a live discovery run.' };
        model = createFakeModelClient(setup.turns ?? happyPathTurns());
        return { ok: true, client: model };
      },
      modelId: setup.modelId === undefined ? 'claude-sonnet-5' : setup.modelId,
      redactor: createRedactor(loaded.allowlist.data),
      budgets: { maxModelCalls: 20, maxActions: 40, maxDurationMs: 300_000 },
      clock,
      ids: createSequentialIds(),
      target: { baseUrl: 'http://localhost:4010' },
      environment: { driver: 'fake', driverVersion: '1.0.0' },
      // Port 0, so every run in this suite binds a free port of its own.
      // Nobody is coming, and nothing here waits to find that out.
      console: { port: 0, claimTimeoutMs: 60_000, claimWindow: async () => undefined },
    });
    return { code, stdout: out.join(''), stderr: err.join(''), leases, paths, model, patterns: loaded.allowlist.data.redactPatterns };
  }

  it('prints no machine path, because what it prints gets pasted into a ticket', async () => {
    const { stdout, stderr, paths } = await run();

    // The evidence root here is an absolute temporary directory, which is the case that found
    // this defect twice. What comes out names the run and not the machine.
    expect(looksLikeMachinePath(paths.evidence)).toBe(true);
    for (const line of [...stdout.split('\n'), ...stderr.split('\n')]) {
      expect(looksLikeMachinePath(line.trim()), line).toBe(false);
      expect(line).not.toContain(paths.evidence);
    }
    expect(JSON.parse(stdout)).toMatchObject({ evidence: 'evidence/discovery/run_000001' });
  });

  it('offers the model a way to declare a write only when the request permits the run to write', async () => {
    const readOnly = await run();
    const writing = await run({ request: { ...REQUEST, allowWrites: true } });

    expect(JSON.stringify(readOnly.model?.requests[0]?.params.tools)).not.toContain('submits');
    expect(JSON.stringify(writing.model?.requests[0]?.params.tools)).toContain('submits');
  });

  it('discovers, writes the draft capability and the evidence the brief asks for, and exits 0', async () => {
    const { code, stdout, stderr, paths } = await run();

    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ runId: 'run_000001', status: 'done', capability: { id: 'member.readSavingsBalance', version: '1.0.0' } });
    // The artifact, the sheet a reviewer reads and the tool definition a calling agent uses.
    expect(await filesUnder(paths.capabilities)).toEqual([
      'member.readSavingsBalance@1.0.0.json',
      'member.readSavingsBalance@1.0.0.md',
      'member.readSavingsBalance@1.0.0.tool.json',
    ]);
    expect(await filesUnder(paths.evidence)).toEqual([
      'discovery/run_000001/artifact.json',
      'discovery/run_000001/captures/final.a11y.json',
      'discovery/run_000001/captures/final.png',
      'discovery/run_000001/captures/step-00-initial.a11y.json',
      'discovery/run_000001/captures/step-00-initial.png',
      'discovery/run_000001/log.jsonl',
      'discovery/run_000001/manifest.json',
      'discovery/run_000001/trace.jsonl',
      'discovery/run_000001/transcript.jsonl',
    ]);
  });

  it('leaves no seeded member data and no redaction pattern match in anything it wrote', async () => {
    const { patterns } = await run();

    const scan = await scanDirectories(root, ['evidence', 'capabilities'], { canaries: await canariesFromSeed('apps/target/seed.json'), patterns });

    expect(scan.filesScanned).toBeGreaterThan(5);
    expect(scan.hits).toEqual([]);
  });

  it('persists a summary with no local path and no capability file name for a pattern to mistake', async () => {
    const { stdout, paths } = await run();
    const directory = join(paths.evidence, 'discovery', 'run_000001');
    const persisted = [await readFile(join(directory, 'log.jsonl'), 'utf8'), await readFile(join(directory, 'manifest.json'), 'utf8')].join('\n');

    expect(persisted).not.toContain(root);
    expect(persisted).not.toContain(JSON.stringify(root).slice(1, -1));
    expect(persisted).not.toContain('[redacted:');
    expect(persisted).toContain('"evidence":"evidence/discovery/run_000001"');
    // The id and the version. Where the file landed is the caller's own capabilities
    // directory, and printing the absolute path of it is how a username reached a ticket.
    expect(JSON.parse(stdout)).toMatchObject({ capability: { id: 'member.readSavingsBalance', version: '1.0.0' } });
    expect(stdout).not.toContain(paths.capabilities);
  });

  it('keeps observation hashes, decisions, authorization verdicts, actions and derivations in the trace', async () => {
    const { paths } = await run();
    const text = await readFile(join(paths.evidence, 'discovery', 'run_000001', 'trace.jsonl'), 'utf8');

    const kinds = new Set(text.trim().split('\n').map((line): unknown => Reflect.get(JSON.parse(line), 't')));
    expect([...kinds].map(String).sort()).toEqual(['action', 'authorization', 'decision', 'derivation', 'observation']);
  });

  it('records the exchange as a cassette that drives the same run offline, and never overwrites a cassette', async () => {
    const cassettePath = join(root, 'cassette.json');

    const recorded = await run({ extraArgs: ['--cassette', cassettePath] });
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(Cassette.parse(JSON.parse(await readFile(cassettePath, 'utf8'))).exchanges).toHaveLength(5);

    // The recording carries the tool set the run was actually given. A cassette of a write run
    // that recorded the read only tools would not match itself on replay.
    const writeCassette = join(root, 'write-cassette.json');
    await run({ request: { ...REQUEST, allowWrites: true }, extraArgs: ['--cassette', writeCassette] });
    expect(JSON.stringify(Cassette.parse(JSON.parse(await readFile(writeCassette, 'utf8'))).tools)).toContain('submits');

    const again = await run({ extraArgs: ['--cassette', cassettePath] });
    expect([again.code, again.leases]).toEqual([2, 0]);

    const offline = await run({
      argv: (paths) => ['--request', paths.request, '--evidence', join(root, 'offline-evidence'), '--capabilities', join(root, 'offline-capabilities'), '--model-cassette', cassettePath],
      liveModel: 'forbidden',
      modelId: null,
    });
    expect(offline.code, offline.stderr).toBe(0);
    expect(await filesUnder(join(root, 'offline-capabilities'))).toEqual([
      'member.readSavingsBalance@1.0.0.json',
      'member.readSavingsBalance@1.0.0.md',
      'member.readSavingsBalance@1.0.0.tool.json',
    ]);
  });

  it('says what it is doing before it opens a browser or calls the model, so a slow run reads as a working one', async () => {
    const { stderr, model } = await run();

    const lines = stderr.split('\n').filter((line) => line.trim() !== '');
    // The run id and where the evidence is going, before anything slow has happened.
    expect(lines[0]).toContain('run_000001');
    expect(lines[0]).toContain('member.readSavingsBalance');
    expect(stderr).toContain('discovery/run_000001');
    // The session is up and the console is listening, which is the other thing a person
    // watching a silent terminal needs to know.
    expect(stderr).toContain('console');
    // One line per decision, so a live run can be followed without opening the trace.
    expect(stderr).toMatch(/\bfill\b/);
    expect(model?.requests.length).toBeGreaterThan(0);
  });

  it('asks the model the goal the request file carries, word for word', async () => {
    const { model } = await run();

    const first = model?.requests[0]?.params.messages[0];
    const text = typeof first?.content === 'string' ? first.content : JSON.stringify(first?.content);
    // The fix for the first live write run was to name the form in the goal. That is worth
    // nothing unless the goal reaches the model unchanged, which is what this asserts.
    expect(text).toContain(REQUEST.goal);
  });

  it('exits 3 and writes no capability when the model asks for a person', async () => {
    const { code, stdout, paths } = await run({ turns: [call('escalate', { reason: 'The search form is not on the page.' })] });

    expect(code).toBe(3);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'escalated', reason: 'ModelRequested', capability: null });
    await expect(access(paths.capabilities)).rejects.toThrow();
  });

  it('exits 1 without a capability when the run cannot be generalized', async () => {
    const { code, stdout } = await run({ turns: [call('done')] });

    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ status: 'done', capability: null, generalization: { failure: 'NoSteps' } });
  });

  it('refuses inputs passed as arguments without repeating them, and invalid inputs, before any session', async () => {
    const onArgv = await run({ extraArgs: ['--memberId', '10001'] });
    const invalid = await run({ stdin: '{"memberId":"abc"}' });

    expect([onArgv.code, onArgv.stdout, onArgv.leases]).toEqual([2, '', 0]);
    expect(onArgv.stderr).not.toContain('10001');
    expect([invalid.code, invalid.leases]).toEqual([2, 0]);
  });

  it('refuses a live run with no model id or no key, before any session', async () => {
    const noModel = await run({ modelId: null });
    const noKey = await run({ liveModel: 'unavailable' });

    expect([noModel.code, noModel.leases]).toEqual([2, 0]);
    expect(noModel.stderr).toContain('ANTHROPIC_MODEL');
    expect([noKey.code, noKey.leases]).toEqual([2, 0]);
    expect(noKey.stderr).toContain('ANTHROPIC_API_KEY');
  });

  it('refuses a request file that does not validate', async () => {
    await writeFile(join(root, 'bad.json'), JSON.stringify({ ...REQUEST, goal: '' }));

    const { code, leases, stderr } = await run({ argv: (paths) => ['--request', join(root, 'bad.json'), '--evidence', paths.evidence] });

    expect([code, leases]).toEqual([2, 0]);
    expect(stderr).toContain('goal');
  });
});

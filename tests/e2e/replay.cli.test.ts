import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { createFileCapabilityStore } from '../../src/evidence/capabilityStore.js';
import { loadAllowlist } from '../../src/runtime/allowlist.js';
import { readSavingsBalanceFixture } from '../fixtures/capabilities/readSavingsBalance.js';

// The replay bin as a caller runs it, a separate process against MERIDIAN Core on the port the
// committed allowlist names. Inputs go in on stdin. What is checked is what a caller sees, the
// exit code and one JSON document on stdout.

const REPOSITORY = resolve(import.meta.dirname, '../..');
const PORT = 4010;

interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runReplay(args: readonly string[], stdin: string): Promise<CliRun> {
  // The child gets no model key. Replay needs none, and the suite never handles one.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ANTHROPIC_')));
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/replay.ts', ...args], {
      cwd: REPOSITORY,
      env: { ...inherited, TARGET_BASE_URL: `http://localhost:${PORT}`, TARGET_USERNAME: 'operator', TARGET_PASSWORD: 'meridian-fixture' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => done({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe('npm run replay against MERIDIAN Core', () => {
  let server: Server | undefined;
  let root = '';
  let capabilityPath = '';

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: false, idSeed: 'e2e' });
    server = await new Promise<Server>((listening, reject) => {
      const bound = app.listen(PORT, '127.0.0.1');
      bound.once('listening', () => listening(bound));
      bound.once('error', (error: NodeJS.ErrnoException) =>
        reject(error.code === 'EADDRINUSE' ? new Error(`Port ${PORT} is in use. Stop npm run target first, because this suite starts its own app on the port the allowlist names.`) : error),
      );
    });

    root = await mkdtemp(join(tmpdir(), 'replay-e2e-'));
    const loaded = await loadAllowlist(join(REPOSITORY, 'policy/allowlist.yaml'));
    if (!loaded.ok) throw new Error(loaded.message);
    const written = await createFileCapabilityStore({ directory: join(root, 'capabilities'), redactor: createRedactor(loaded.allowlist.data) }).write(readSavingsBalanceFixture(), { inputValues: {} });
    if (!written.ok) throw new Error(written.detail);
    capabilityPath = written.path;
  });

  afterAll(async () => {
    const bound = server;
    if (bound !== undefined) await new Promise<void>((closed) => bound.close(() => closed()));
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  const args = (): string[] => ['--capability', capabilityPath, '--evidence', join(root, 'evidence')];

  it('exits 0 and prints the savings balance of member 10001 as JSON', async () => {
    const run = await runReplay(args(), '{"memberId":"10001"}');

    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD' } } });
  });

  it('exits 0 with MEMBER_NOT_FOUND for 00000, a business outcome and not a failure', async () => {
    const run = await runReplay(args(), '{"memberId":"00000"}');

    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND' } });
  });

  it('exits 1 with the failure as JSON when the inputs break the declared constraints', async () => {
    const run = await runReplay(args(), '{"memberId":"abc"}');

    expect(run.code, run.stderr).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'failure', failure: { class: 'InputValidation' } });
  });

  it('exits 2 and repeats nothing when a member id is passed as an argument', async () => {
    const run = await runReplay([...args(), '--memberId', '10001'], '');

    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).not.toContain('10001');
  });
});

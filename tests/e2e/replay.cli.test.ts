import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { createFileCapabilityStore } from '../../src/evidence/capabilityStore.js';
import { loadAllowlist } from '../../src/runtime/allowlist.js';
import { readSavingsBalanceFixture } from '../fixtures/capabilities/readSavingsBalance.js';
import { REPOSITORY, runCli, startTarget, stopTarget } from './harness.js';

// The replay bin as a caller runs it, against MERIDIAN Core. Inputs go in on stdin. What is
// checked is what a caller sees, the exit code and one JSON document on stdout.

describe('npm run replay against MERIDIAN Core', () => {
  let server: ChildProcess | undefined;
  let root = '';
  let capabilityPath = '';

  beforeAll(async () => {
    server = await startTarget('e2e-replay');
    root = await mkdtemp(join(tmpdir(), 'replay-e2e-'));
    const loaded = await loadAllowlist(join(REPOSITORY, 'policy/allowlist.yaml'));
    if (!loaded.ok) throw new Error(loaded.message);
    const written = await createFileCapabilityStore({ directory: join(root, 'capabilities'), redactor: createRedactor(loaded.allowlist.data) }).write(readSavingsBalanceFixture(), { inputValues: {} });
    if (!written.ok) throw new Error(written.detail);
    capabilityPath = written.path;
  });

  afterAll(async () => {
    await stopTarget(server);
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  const replay = (extra: readonly string[], stdin: string) => runCli('src/cli/replay.ts', ['--capability', capabilityPath, '--evidence', join(root, 'evidence'), ...extra], stdin);

  it('exits 0 and prints the savings balance of member 10001 as JSON', async () => {
    const run = await replay([], '{"memberId":"10001"}');

    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD' } } });
  });

  it('exits 0 with MEMBER_NOT_FOUND for 00000, a business outcome and not a failure', async () => {
    const run = await replay([], '{"memberId":"00000"}');

    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND' } });
  });

  it('exits 1 with the failure as JSON when the inputs break the declared constraints', async () => {
    const run = await replay([], '{"memberId":"abc"}');

    expect(run.code, run.stderr).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'failure', failure: { class: 'InputValidation' } });
  });

  it('exits 2 and repeats nothing when a member id is passed as an argument', async () => {
    const run = await replay(['--memberId', '10001'], '');

    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).not.toContain('10001');
  });
});

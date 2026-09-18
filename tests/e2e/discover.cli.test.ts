import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Capability } from '../../src/core/capability/schema.js';
import { canariesFromSeed, scanDirectories } from '../../src/evidence/scanner.js';
import { loadAllowlist } from '../../src/runtime/allowlist.js';
import { REPOSITORY, runCli, startTarget, stopTarget } from './harness.js';

// Skeleton 2. The whole thread offline against MERIDIAN Core, with no key and no model
// variables, driven by the model exchange recorded during the live run at S4-T08. Discovery
// writes the draft, the negative probe review declares MEMBER_NOT_FOUND from the real banner,
// and the reviewed version replays both ways. The model's decisions are real, they are frozen.

const CASSETTE = 'tests/fixtures/cassettes/discover.member.readSavingsBalance.json';
const REQUEST = 'requests/member.readSavingsBalance.json';
const REVIEW = 'requests/member.readSavingsBalance.MEMBER_NOT_FOUND.review.json';

describe('the discovery thread, offline from the recorded live exchange', () => {
  let server: ChildProcess | undefined;
  let root = '';

  beforeAll(async () => {
    server = await startTarget('e2e-thread');
    root = await mkdtemp(join(tmpdir(), 'thread-e2e-'));
  });

  afterAll(async () => {
    await stopTarget(server);
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  it(
    'discovers, reviews and replays both ways, and leaves no member data behind',
    async () => {
      const evidence = join(root, 'evidence');
      const capabilities = join(root, 'capabilities');

      const discovered = await runCli('src/cli/discover.ts', ['--request', REQUEST, '--evidence', evidence, '--capabilities', capabilities, '--model-cassette', CASSETTE], '{"memberId":"10001"}');
      expect(discovered.code, discovered.stderr).toBe(0);
      expect(JSON.parse(discovered.stdout)).toMatchObject({ status: 'done', modelCalls: 5, capability: { id: 'member.readSavingsBalance', version: '1.0.0' } });

      const draft = join(capabilities, 'member.readSavingsBalance@1.0.0.json');
      const reviewed = await runCli('src/cli/review.ts', ['--capability', draft, '--decision', REVIEW, '--evidence', evidence], '{"memberId":"00000"}');
      expect(reviewed.code, reviewed.stderr).toBe(0);
      expect(JSON.parse(reviewed.stdout)).toMatchObject({ status: 'declared', code: 'MEMBER_NOT_FOUND', verification: { status: 'business_outcome' } });

      const path = join(capabilities, 'member.readSavingsBalance@1.1.0.json');
      const capability = Capability.parse(JSON.parse(await readFile(path, 'utf8')));
      expect(capability.steps.map((step) => step.action.kind)).toEqual(['fill', 'click', 'click']);
      expect(capability.outcomes.map((outcome) => outcome.code)).toEqual(['MEMBER_NOT_FOUND']);

      const success = await runCli('src/cli/replay.ts', ['--capability', path, '--evidence', evidence], '{"memberId":"10001"}');
      expect(success.code, success.stderr).toBe(0);
      expect(JSON.parse(success.stdout)).toMatchObject({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD' } } });

      const outcome = await runCli('src/cli/replay.ts', ['--capability', path, '--evidence', evidence], '{"memberId":"00000"}');
      expect(outcome.code, outcome.stderr).toBe(0);
      expect(JSON.parse(outcome.stdout)).toMatchObject({ status: 'business_outcome', outcome: { code: 'MEMBER_NOT_FOUND', terminal: true } });

      const loaded = await loadAllowlist(join(REPOSITORY, 'policy/allowlist.yaml'));
      if (!loaded.ok) throw new Error(loaded.message);
      const scan = await scanDirectories(root, ['evidence', 'capabilities'], { canaries: await canariesFromSeed(join(REPOSITORY, 'apps/target/seed.json')), patterns: loaded.allowlist.data.redactPatterns });
      expect(scan.filesScanned).toBeGreaterThan(10);
      expect(scan.hits).toEqual([]);
    },
    300_000,
  );
});

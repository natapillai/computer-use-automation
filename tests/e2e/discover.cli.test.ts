import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Capability } from '../../src/core/capability/schema.js';
import { canariesFromSeed, scanDirectories } from '../../src/evidence/scanner.js';
import { loadAllowlist } from '../../src/runtime/allowlist.js';
import { REPOSITORY, runCli, startTarget, stopTarget } from './harness.js';

// The discover bin driven by the model exchange recorded in the S2-T01 live spike, against
// MERIDIAN Core, with no key and no model variables. It proves the bin wires a real browser,
// the broker, the loop, the generalizer and the store together before a live run spends
// anything, and the draft it writes is replayed by the replay bin.

const SPIKE_CASSETTE = 'tests/fixtures/cassettes/discovery.readSavingsBalance.json';

describe('npm run discover driven by the recorded spike exchange', () => {
  let server: Server | undefined;
  let root = '';

  beforeAll(async () => {
    server = await startTarget('e2e-discover');
    root = await mkdtemp(join(tmpdir(), 'discover-e2e-'));
  });

  afterAll(async () => {
    await stopTarget(server);
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  it('discovers member.readSavingsBalance, leaves no member data behind, and the draft replays to 425075 USD', async () => {
    const discovered = await runCli(
      'src/cli/discover.ts',
      ['--request', 'requests/member.readSavingsBalance.json', '--evidence', join(root, 'evidence'), '--capabilities', join(root, 'capabilities'), '--model-cassette', SPIKE_CASSETTE],
      '{"memberId":"10001"}',
    );

    expect(discovered.code, discovered.stderr).toBe(0);
    expect(JSON.parse(discovered.stdout)).toMatchObject({ status: 'done', modelCalls: 5, capability: { id: 'member.readSavingsBalance', version: '1.0.0' } });

    const path = join(root, 'capabilities', 'member.readSavingsBalance@1.0.0.json');
    const capability = Capability.parse(JSON.parse(await readFile(path, 'utf8')));
    expect(capability.steps.map((step) => step.action.kind)).toEqual(['fill', 'click', 'click']);
    expect(capability.lifecycle.status).toBe('draft');

    const loaded = await loadAllowlist(join(REPOSITORY, 'policy/allowlist.yaml'));
    if (!loaded.ok) throw new Error(loaded.message);
    const scan = await scanDirectories(root, ['evidence', 'capabilities'], { canaries: await canariesFromSeed(join(REPOSITORY, 'apps/target/seed.json')), patterns: loaded.allowlist.data.redactPatterns });
    expect(scan.filesScanned).toBeGreaterThan(5);
    expect(scan.hits).toEqual([]);

    const replayed = await runCli('src/cli/replay.ts', ['--capability', path, '--evidence', join(root, 'evidence')], '{"memberId":"10001"}');
    expect(replayed.code, replayed.stderr).toBe(0);
    expect(JSON.parse(replayed.stdout)).toMatchObject({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD' } } });
  });
});

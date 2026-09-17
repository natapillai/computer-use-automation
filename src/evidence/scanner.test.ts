import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAllowlist } from '../runtime/allowlist.js';
import { canariesFromSeed, GUARDED_DIRECTORIES, scanDirectories } from './scanner.js';

// A permanent test, not a pre commit script, see docs/EVIDENCE.md section 5. It proves it
// can see a planted canary, then fails the suite on any hit in the committed tree.

async function rules() {
  const loaded = await loadAllowlist('policy/allowlist.yaml');
  if (!loaded.ok) throw new Error(loaded.message);
  return { canaries: await canariesFromSeed('apps/target/seed.json'), patterns: loaded.allowlist.data.redactPatterns };
}

describe('canariesFromSeed', () => {
  it('lists the seeded member ids, names, balances and the card with and without spaces', async () => {
    const canaries = await canariesFromSeed('apps/target/seed.json');

    expect(canaries).toEqual(expect.arrayContaining(['10001', 'Test Member One', '$4,250.75', '1980.40 USD', '(125.00)', '$0.00', '4111 1111 1111 1111', '4111111111111111']));
  });

  it('lists every form a seeded value takes after parsing, because a leak is rarely in display form', async () => {
    const canaries = await canariesFromSeed('apps/target/seed.json');

    // The balance the brief's example reads, as minor units, as a plain decimal and as text.
    expect(canaries).toEqual(expect.arrayContaining(['425075', '4250.75', '$4,250.75']));
    expect(canaries).toEqual(expect.arrayContaining(['198040', '1980.40']));
    // A negative balance, both ways round.
    expect(canaries).toEqual(expect.arrayContaining(['12500', '-12500', '125.00']));
    // A card as a formatter might group it.
    expect(canaries).toEqual(expect.arrayContaining(['4111-1111-1111-1111']));
    // Zero is not a canary. It would match the fraction of every confidence in every bundle.
    expect(canaries).not.toContain('0');
  });
});

describe('evidence scanner', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'scan-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('fails on a canary planted in any guarded directory and names the file and line', async () => {
    await mkdir(join(root, 'evidence', 'replay', 'success', 'run_1'), { recursive: true });
    await writeFile(join(root, 'evidence', 'replay', 'success', 'run_1', 'log.jsonl'), '{"event":"start"}\n{"member":"Test Member One"}\n');
    await mkdir(join(root, 'tests', 'fixtures', 'cassettes'), { recursive: true });
    await writeFile(join(root, 'tests', 'fixtures', 'cassettes', 'clean.json'), '{"note":"[redacted:pii]"}');

    const scan = await scanDirectories(root, GUARDED_DIRECTORIES, await rules());

    expect(scan.filesScanned).toBe(2);
    expect(scan.directoriesFound).toEqual(['evidence', 'tests/fixtures/cassettes']);
    expect(scan.hits).toEqual([{ file: 'evidence/replay/success/run_1/log.jsonl', line: 2, kind: 'canary' }]);
  });

  it('fails on a balance written as minor units, which is the form a parsed money value is stored in', async () => {
    await mkdir(join(root, 'evidence', 'replay', 'success', 'run_1'), { recursive: true });
    await writeFile(join(root, 'evidence', 'replay', 'success', 'run_1', 'log.jsonl'), '{"savingsBalance":{"type":"money","amountMinor":425075,"currency":"USD","raw":"[redacted:pii]"}}\n');

    const scan = await scanDirectories(root, GUARDED_DIRECTORIES, await rules());

    expect(scan.hits).toEqual([{ file: 'evidence/replay/success/run_1/log.jsonl', line: 1, kind: 'canary' }]);
  });

  it('does not fire on a timestamp, which a zero balance in decimal form would match', async () => {
    await mkdir(join(root, 'evidence', 'replay', 'success', 'run_1'), { recursive: true });
    await writeFile(join(root, 'evidence', 'replay', 'success', 'run_1', 'log.jsonl'), '{"at":"2026-09-15T09:00:00.000Z","level":"info","event":"replay.started"}\n');

    const scan = await scanDirectories(root, GUARDED_DIRECTORIES, await rules());

    expect(scan.hits).toEqual([]);
  });

  it('skips screenshots, whose masking is proven by reading pixels back', async () => {
    await mkdir(join(root, 'evidence', 'captures'), { recursive: true });
    await writeFile(join(root, 'evidence', 'captures', 'step-00.png'), Buffer.from('4111 1111 1111 1111'));

    expect(await scanDirectories(root, GUARDED_DIRECTORIES, await rules())).toMatchObject({ filesScanned: 0, hits: [] });
  });

  it('finds no canary and no pattern match anywhere in the committed guarded directories', async () => {
    const scan = await scanDirectories('.', GUARDED_DIRECTORIES, await rules());

    expect(scan.hits).toEqual([]);
    if (scan.directoriesFound.length > 0) expect(scan.filesScanned).toBeGreaterThan(0);
  });
});

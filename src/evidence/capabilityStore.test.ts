import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSavingsBalanceFixture } from '../../tests/fixtures/capabilities/readSavingsBalance.js';
import { Capability } from '../core/capability/schema.js';
import { createRedactor } from '../core/redaction/redactor.js';
import { loadAllowlist } from '../runtime/allowlist.js';
import { canonicalCapabilityJson, createFileCapabilityStore, type CapabilityStore } from './capabilityStore.js';

// The writer is where the no sensitive literal rule is enforced, see docs/ARTIFACT_SCHEMA.md
// section 4. It runs under the real allowlist, so a clean artifact is proven not to trip it.

const inputValues = { memberId: '10001' };
const FILE = 'member.readSavingsBalance@1.0.0.json';

async function storeAt(directory: string): Promise<CapabilityStore> {
  const loaded = await loadAllowlist('policy/allowlist.yaml');
  if (!loaded.ok) throw new Error(loaded.message);
  return createFileCapabilityStore({ directory, redactor: createRedactor(loaded.allowlist.data) });
}

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversedKeys(child)]));
  return value;
}

describe('canonicalCapabilityJson', () => {
  it('writes the same bytes whatever order the keys arrived in, in schema order with a final newline', () => {
    const text = canonicalCapabilityJson(Capability.parse(readSavingsBalanceFixture()));

    expect(canonicalCapabilityJson(Capability.parse(reversedKeys(readSavingsBalanceFixture())))).toBe(text);
    expect(text.startsWith('{\n  "schemaVersion": "1.0.0",\n  "id": "member.readSavingsBalance",\n  "version": "1.0.0",')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });
});

describe('FileCapabilityStore', () => {
  let directory: string;
  let store: CapabilityStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'capabilities-'));
    store = await storeAt(directory);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('writes the review sheet and the tool schema beside the artifact', async () => {
    const written = await store.write(readSavingsBalanceFixture(), { inputValues });

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    // A sheet nobody can find is a function with a test. These sit next to the artifact, so
    // a reviewer opening the directory has the thing they need in order to decide.
    const sheet = await readFile(written.path.replace(/\.json$/, '.md'), 'utf8');
    const tool: unknown = JSON.parse(await readFile(written.path.replace(/\.json$/, '.tool.json'), 'utf8'));
    expect(sheet).toContain('Inputs');
    expect(sheet).not.toContain('10001');
    expect(Reflect.get(tool as object, 'name')).toBe('member_readSavingsBalance');
  });

  it('writes <id>@<version>.json and a read and rewrite produces the same bytes', async () => {
    expect(await store.write(readSavingsBalanceFixture(), { inputValues })).toEqual({ ok: true, path: join(directory, FILE) });
    const bytes = await readFile(join(directory, FILE), 'utf8');

    const read = await store.read('member.readSavingsBalance', '1.0.0');
    if (!read.ok) throw new Error(`The read failed with ${read.failure}.`);
    const second = await mkdtemp(join(tmpdir(), 'capabilities-'));
    try {
      await (await storeAt(second)).write(read.capability, { inputValues });
      expect(await readFile(join(second, FILE), 'utf8')).toBe(bytes);
    } finally {
      await rm(second, { recursive: true, force: true });
    }
  });

  it('refuses a pii input value that survived as a literal, names the input and writes nothing', async () => {
    const result = await store.write({ ...readSavingsBalanceFixture(), description: 'Reads the balance of member 10001.' }, { inputValues });

    expect(result).toMatchObject({ ok: false, failure: 'SensitiveLiteral' });
    expect(JSON.stringify(result)).toContain('memberId');
    expect(JSON.stringify(result)).not.toContain('10001');
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses text the redactor would hide, such as a card number, without repeating it', async () => {
    const result = await store.write({ ...readSavingsBalanceFixture(), description: 'Card 4111 1111 1111 1111.' }, { inputValues });

    expect(result).toMatchObject({ ok: false, failure: 'SensitiveLiteral' });
    expect(JSON.stringify(result)).toContain('cardNumber');
    expect(JSON.stringify(result)).not.toContain('4111');
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses an artifact that does not validate', async () => {
    expect(await store.write({ ...readSavingsBalanceFixture(), steps: [] }, { inputValues })).toMatchObject({ ok: false, failure: 'CapabilityInvalid' });
    expect(await readdir(directory)).toEqual([]);
  });

  it('never overwrites a version with different content, and rewriting the same content is harmless', async () => {
    await store.write(readSavingsBalanceFixture(), { inputValues });
    const bytes = await readFile(join(directory, FILE), 'utf8');

    expect(await store.write({ ...readSavingsBalanceFixture(), description: 'Changed after review.' }, { inputValues })).toMatchObject({ ok: false, failure: 'VersionExists' });
    expect(await readFile(join(directory, FILE), 'utf8')).toBe(bytes);
    expect(await store.write(readSavingsBalanceFixture(), { inputValues })).toMatchObject({ ok: true });
  });

  it('approves a draft by writing only its lifecycle', async () => {
    await store.write(readSavingsBalanceFixture(), { inputValues });
    const before = await readFile(join(directory, FILE), 'utf8');

    const approved = await store.approve('member.readSavingsBalance', '1.0.0', { approvedBy: 'operator-7', approvedAt: '2026-09-16T10:00:00.000Z' });

    expect(approved).toMatchObject({ ok: true, capability: { lifecycle: { status: 'approved', approvedBy: 'operator-7', approvedAt: '2026-09-16T10:00:00.000Z' } } });
    const after = await readFile(join(directory, FILE), 'utf8');
    expect(JSON.parse(after)).toEqual({ ...JSON.parse(before), lifecycle: { status: 'approved', approvedBy: 'operator-7', approvedAt: '2026-09-16T10:00:00.000Z' } });
  });

  it('refuses to approve a version that is missing or already approved', async () => {
    await store.write(readSavingsBalanceFixture(), { inputValues });
    await store.approve('member.readSavingsBalance', '1.0.0', { approvedBy: 'operator-7', approvedAt: '2026-09-16T10:00:00.000Z' });

    expect(await store.approve('member.readSavingsBalance', '1.0.0', { approvedBy: 'operator-8', approvedAt: '2026-09-16T11:00:00.000Z' })).toMatchObject({ ok: false, failure: 'NotDraft' });
    expect(await store.approve('member.none', '1.0.0', { approvedBy: 'operator-7', approvedAt: '2026-09-16T10:00:00.000Z' })).toMatchObject({ ok: false, failure: 'NotFound' });
  });

  it('reads a missing version as NotFound, a future schema as SchemaIncompatible, and refuses a reference outside the directory', async () => {
    await writeFile(join(directory, 'member.future@1.0.0.json'), JSON.stringify({ schemaVersion: '9.0.0' }));

    expect(await store.read('member.none', '1.0.0')).toMatchObject({ ok: false, failure: 'NotFound' });
    expect(await store.read('member.future', '1.0.0')).toMatchObject({ ok: false, failure: 'SchemaIncompatible' });
    expect(await store.read('../secrets', '1.0.0')).toMatchObject({ ok: false, failure: 'InvalidReference' });
  });
});

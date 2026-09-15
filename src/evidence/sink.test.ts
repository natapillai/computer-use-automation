import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRedactor } from '../core/redaction/redactor.js';
import { createTestClock } from '../runtime/clock.js';
import { createEvidenceSink, projections, type ManifestSummary } from './sink.js';

const redactor = createRedactor({
  neverPersist: ['password', 'token'],
  redactPatterns: [{ name: 'cardNumber', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', flags: 'g', validator: 'luhn' }],
});

const summary: ManifestSummary = {
  capability: { id: 'member.readSavingsBalance', version: '1.0.0' },
  goal: null,
  target: { appId: 'meridian-core', baseUrl: 'http://localhost:4010' },
  result: { status: 'success', summary: 'Read the savings balance.' },
  counts: { steps: 4, modelCalls: 0, actions: 5, recoveries: 0, drift: 0, escalations: 0 },
  environment: { driver: 'web', driverVersion: '1.0.0', model: null, promptVersion: null },
};

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? filesUnder(join(directory, entry.name), `${prefix}${entry.name}/`) : Promise.resolve([`${prefix}${entry.name}`]))),
  );
  return nested.flat().sort();
}

describe('EvidenceSink', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'evidence-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function sink() {
    return createEvidenceSink({ root, phase: 'replay', runId: 'run_000001', redactor, clock: createTestClock('2026-09-15T09:00:00.000Z') });
  }

  it('writes log lines that are valid JSON, carry the run id, and are redacted at the sink', async () => {
    const evidence = await sink();
    evidence.addKnown({ known: [{ value: '10001', replacement: '{{inputs.memberId}}' }] });

    await evidence.log('info', 'step.acted', { url: '/member/10001', card: '4111 1111 1111 1111', session: { accessToken: 'abc' } });
    await evidence.log('warn', 'step.slow', { stepId: 'submitSearch' });

    const lines = (await readFile(join(evidence.directory, 'log.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line) as unknown);
    expect(first).toEqual({
      at: '2026-09-15T09:00:00.000Z',
      level: 'info',
      runId: 'run_000001',
      event: 'step.acted',
      url: '/member/{{inputs.memberId}}',
      card: '[redacted:cardNumber]',
      session: { accessToken: '[redacted:token]' },
    });
    expect(second).toMatchObject({ level: 'warn', runId: 'run_000001', event: 'step.slow', stepId: 'submitSearch' });
    expect(lines.join('\n')).not.toMatch(/10001|4111/);
  });

  it('redacts trace lines, JSON files and snapshots the same way', async () => {
    const evidence = await sink();
    evidence.addKnown({ known: [{ value: '10001', replacement: '{{inputs.memberId}}' }] });

    await evidence.appendJsonLine('trace.jsonl', 'trace', 'Every observation, decision and action', { t: 'action', url: '/member/10001' });
    await evidence.writeJson('captures/step-03.a11y.json', 'snapshot', 'Member detail', { name: 'Member No:', value: '10001' });

    expect(await readFile(join(evidence.directory, 'trace.jsonl'), 'utf8')).not.toContain('10001');
    expect(await readFile(join(evidence.directory, 'captures/step-03.a11y.json'), 'utf8')).not.toContain('10001');
  });

  it('writes a manifest listing every file it wrote, with counts of what redaction matched and no values', async () => {
    const evidence = await sink();
    evidence.addKnown({ known: [{ value: '10001', replacement: '{{inputs.memberId}}' }] });
    await evidence.log('info', 'run.started', { memberUrl: '/member/10001', card: '4111 1111 1111 1111' });
    await evidence.appendJsonLine('trace.jsonl', 'trace', 'Every observation, decision and action', { t: 'result', status: 'success' });
    await evidence.writeScreenshot('captures/step-00-initial.png', 'Run start', new Uint8Array([137, 80, 78, 71]));

    const manifest = await evidence.close(summary);

    const onDisk = JSON.parse(await readFile(join(evidence.directory, 'manifest.json'), 'utf8')) as unknown;
    expect(onDisk).toEqual(manifest);
    expect(manifest).toMatchObject({ runId: 'run_000001', phase: 'replay', startedAt: '2026-09-15T09:00:00.000Z', redaction: { applied: true, patternsMatched: { known: 1, cardNumber: 1 } } });
    expect(manifest.files.map((file) => file.path).sort()).toEqual(['captures/step-00-initial.png', 'log.jsonl', 'trace.jsonl']);
    expect(await filesUnder(evidence.directory)).toEqual(['captures/step-00-initial.png', 'log.jsonl', 'manifest.json', 'trace.jsonl']);
  });

  it('refuses a path that would leave the run directory', async () => {
    const evidence = await sink();

    await expect(evidence.writeJson('../escape.json', 'artifact', 'Outside', {})).rejects.toThrow(TypeError);
  });
});

describe('projections', () => {
  it('names a caller projection with real values and a persisted projection that is redacted', () => {
    const result = { status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD', raw: '$4,250.75' } } };

    const projected = projections(result, redactor, { known: [{ value: '$4,250.75', replacement: '[redacted:pii]' }] });

    expect(projected.caller).toBe(result);
    expect(projected.persisted).toEqual({ status: 'success', outputs: { savingsBalance: { type: 'money', amountMinor: 425075, currency: 'USD', raw: '[redacted:pii]' } } });
  });
});

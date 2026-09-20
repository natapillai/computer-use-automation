import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { KnownValue, RedactionContext, Redactor } from '../core/redaction/redactor.js';
import { asReference } from '../cli/paths.js';
import type { Clock } from '../runtime/clock.js';

// The one place run evidence is written, see docs/EVIDENCE.md. Every text byte passes
// through the redactor here, at the sink, so a caller cannot forget to redact. Screenshots
// arrive already masked, because the unmasked buffer must never exist.

export type EvidencePhase = 'discovery' | 'review' | 'replay';
export type EvidenceKind = 'log' | 'trace' | 'transcript' | 'artifact' | 'screenshot' | 'snapshot' | 'humanActions' | 'diff';

export interface ManifestFile {
  readonly path: string;
  readonly kind: EvidenceKind;
  readonly description: string;
}

export interface ManifestSummary {
  readonly capability: { readonly id: string; readonly version: string } | null;
  readonly goal: string | null;
  readonly target: { readonly appId: string; readonly baseUrl: string };
  readonly result: { readonly status: string; readonly code?: string; readonly summary: string };
  readonly counts: {
    readonly steps: number;
    readonly modelCalls: number;
    readonly actions: number;
    readonly recoveries: number;
    readonly drift: number;
    readonly escalations: number;
  };
  readonly environment: { readonly driver: string; readonly driverVersion: string; readonly model: string | null; readonly promptVersion: string | null };
}

export interface RunManifest extends ManifestSummary {
  readonly runId: string;
  readonly phase: EvidencePhase;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly files: readonly ManifestFile[];
  readonly redaction: { readonly applied: true; readonly patternsMatched: Readonly<Record<string, number>> };
}

export interface EvidenceSink {
  readonly runId: string;
  readonly directory: string;
  // Where the run is, said in a way that can be pasted into a ticket. directory is the real
  // path on disk and belongs in file operations. This belongs in anything a person reads.
  readonly reference: string;
  // Values learned during the run, such as an extracted balance, join provenance redaction
  // for every later write.
  addKnown(context: RedactionContext): void;
  log(level: 'info' | 'warn' | 'error', event: string, fields?: Readonly<Record<string, unknown>>): Promise<void>;
  appendJsonLine(path: string, kind: EvidenceKind, description: string, value: unknown): Promise<void>;
  writeJson(path: string, kind: EvidenceKind, description: string, value: unknown): Promise<void>;
  writeScreenshot(path: string, description: string, bytes: Uint8Array): Promise<void>;
  close(summary: ManifestSummary): Promise<RunManifest>;
}

export interface EvidenceSinkOptions {
  readonly root: string;
  readonly phase: EvidencePhase;
  readonly runId: string;
  readonly redactor: Redactor;
  readonly clock: Clock;
}

export async function createEvidenceSink(options: EvidenceSinkOptions): Promise<EvidenceSink> {
  const { redactor, clock, runId, phase } = options;
  const directory = resolve(options.root, phase, runId);
  const reference = asReference(options.root, phase, runId);
  await mkdir(directory, { recursive: true });

  const startedAt = clock.now().toISOString();
  const known: KnownValue[] = [];
  const counts: Record<string, number> = {};
  const files = new Map<string, ManifestFile>();

  const context = (): RedactionContext => ({
    known,
    onMatch: (name) => {
      counts[name] = (counts[name] ?? 0) + 1;
    },
  });

  // A path is relative to the run directory and must stay inside it.
  const target = async (path: string, kind: EvidenceKind, description: string): Promise<string> => {
    const full = resolve(directory, path);
    const inside = relative(directory, full);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new TypeError('An evidence path must name a file inside the run directory.');
    }
    await mkdir(dirname(full), { recursive: true });
    const manifestPath = inside.split('\\').join('/');
    files.set(manifestPath, { path: manifestPath, kind, description });
    return full;
  };

  const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};

  return {
    runId,
    directory,
    reference,
    addKnown: (extra) => {
      known.push(...extra.known);
    },
    log: async (level, event, fields = {}) => {
      const redacted = asRecord(redactor.object(fields, context()));
      const line = { at: clock.now().toISOString(), level, runId, event: redactor.text(event, context()), ...omit(redacted, ['at', 'level', 'runId', 'event']) };
      await appendFile(await target('log.jsonl', 'log', 'The structured application log'), `${JSON.stringify(line)}\n`);
    },
    appendJsonLine: async (path, kind, description, value) => {
      await appendFile(await target(path, kind, description), `${JSON.stringify(redactor.object(value, context()))}\n`);
    },
    writeJson: async (path, kind, description, value) => {
      await writeFile(await target(path, kind, description), JSON.stringify(redactor.object(value, context()), null, 2));
    },
    writeScreenshot: async (path, description, bytes) => {
      await writeFile(await target(path, 'screenshot', description), bytes);
    },
    close: async (summary) => {
      const redactedSummary = asRecord(redactor.object(summary, { known }));
      const manifest: RunManifest = {
        runId,
        phase,
        startedAt,
        endedAt: clock.now().toISOString(),
        capability: summary.capability,
        goal: typeof redactedSummary['goal'] === 'string' ? redactedSummary['goal'] : null,
        target: summary.target,
        result: { ...summary.result, summary: redactor.text(summary.result.summary, { known }) },
        counts: summary.counts,
        files: [...files.values()],
        environment: summary.environment,
        redaction: { applied: true, patternsMatched: { ...counts } },
      };
      await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
      return manifest;
    },
  };
}

export interface Projections<T> {
  readonly caller: T;
  readonly persisted: unknown;
}

// A result has two projections, see docs/SAFETY.md section 4. The caller gets real values,
// because a balance returned as [redacted] is a system that does not work. Everything that
// is stored gets the persisted projection.
export function projections<T>(value: T, redactor: Redactor, context: RedactionContext): Projections<T> {
  return { caller: value, persisted: redactor.object(value, context) };
}

function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

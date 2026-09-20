import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InputValue } from '../core/capability/inputs.js';
import { parseCapability } from '../core/capability/load.js';
import { findSensitiveLiterals } from '../core/capability/sensitiveLiterals.js';
import { reviewSheet, toolFor } from '../core/capability/publish.js';
import { Capability } from '../core/capability/schema.js';
import type { Redactor } from '../core/redaction/redactor.js';

// Capabilities on the filesystem, one immutable file per version, see docs/ARTIFACT_SCHEMA.md
// section 5 and ADR 0010. The writer is where the no sensitive literal rule is enforced.
// redactionApplied in an artifact is only a marker. This scan is what makes it true.

export type CapabilityWrite =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly failure: 'SensitiveLiteral' | 'CapabilityInvalid' | 'VersionExists'; readonly detail: string };

export type CapabilityRead =
  | { readonly ok: true; readonly capability: Capability }
  | { readonly ok: false; readonly failure: 'NotFound' | 'InvalidReference' | 'SchemaIncompatible' | 'CapabilityInvalid'; readonly detail: string };

export type CapabilityApproval =
  | { readonly ok: true; readonly path: string; readonly capability: Capability }
  | { readonly ok: false; readonly failure: 'NotFound' | 'InvalidReference' | 'NotDraft' | 'CapabilityInvalid' | 'SchemaIncompatible'; readonly detail: string };

export interface CapabilityStore {
  // inputValues are the values the producing run supplied, so a literal that escaped
  // templating is recognised exactly rather than by pattern.
  write(capability: unknown, context: { readonly inputValues: Readonly<Record<string, InputValue>> }): Promise<CapabilityWrite>;
  read(id: string, version: string): Promise<CapabilityRead>;
  readFile(path: string): Promise<CapabilityRead>;
  // Lifecycle is the one part of a stored version that may change, because approval is a fact
  // about a version rather than a change to it.
  approve(id: string, version: string, approval: { readonly approvedBy: string; readonly approvedAt: string }): Promise<CapabilityApproval>;
  pathFor(id: string, version: string): string;
}

export interface FileCapabilityStoreOptions {
  readonly directory: string;
  readonly redactor: Redactor;
}

const ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

// Parsing rebuilds every object in schema order, so the bytes depend on the content alone and
// a diff in review shows only what changed.
export function canonicalCapabilityJson(capability: Capability): string {
  return `${JSON.stringify(Capability.parse(capability), null, 2)}\n`;
}

export function createFileCapabilityStore(options: FileCapabilityStoreOptions): CapabilityStore {
  const pathFor = (id: string, version: string): string => join(options.directory, `${id}@${version}.json`);

  const readAt = async (path: string): Promise<CapabilityRead> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { ok: false, failure: 'NotFound', detail: `There is no capability file at ${path}.` };
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, failure: 'CapabilityInvalid', detail: `${path} is not valid JSON.` };
    }
    const parsed = parseCapability(json);
    if (parsed.ok) return { ok: true, capability: parsed.capability };
    if (parsed.failure === 'SchemaIncompatible') return { ok: false, failure: 'SchemaIncompatible', detail: parsed.detail };
    return { ok: false, failure: 'CapabilityInvalid', detail: parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join('. ') };
  };

  return {
    pathFor,
    readFile: readAt,
    approve: async (id, version, approval) => {
      if (!ID.test(id) || !SEMVER.test(version)) {
        return { ok: false, failure: 'InvalidReference', detail: 'A capability is named by a dotted lower camel case id and a semantic version.' };
      }
      const path = pathFor(id, version);
      const stored = await readAt(path);
      if (!stored.ok) return { ok: false, failure: stored.failure, detail: stored.detail };
      if (stored.capability.lifecycle.status !== 'draft') {
        return { ok: false, failure: 'NotDraft', detail: `${id} version ${version} is ${stored.capability.lifecycle.status}, and only a draft is approved.` };
      }
      const approved = Capability.safeParse({ ...stored.capability, lifecycle: { status: 'approved', approvedBy: approval.approvedBy, approvedAt: approval.approvedAt } });
      if (!approved.success) {
        return { ok: false, failure: 'CapabilityInvalid', detail: approved.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('. ') };
      }
      await writeFile(path, canonicalCapabilityJson(approved.data));
      // The sheet and the tool definition sit beside the artifact and describe it, so an
      // approval rewrites them too. A sheet that still says draft next to an approved file
      // is the exact failure these are written beside the artifact to avoid.
      await writeSidecars(path, approved.data);
      return { ok: true, path, capability: approved.data };
    },
    read: async (id, version) => {
      if (!ID.test(id) || !SEMVER.test(version)) {
        return { ok: false, failure: 'InvalidReference', detail: 'A capability is named by a dotted lower camel case id and a semantic version.' };
      }
      return readAt(pathFor(id, version));
    },
    write: async (candidate, context) => {
      const parsed = Capability.safeParse(candidate);
      if (!parsed.success) {
        return { ok: false, failure: 'CapabilityInvalid', detail: parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('. ') };
      }
      const capability = parsed.data;
      const text = canonicalCapabilityJson(capability);

      const leaks = findSensitiveLiterals(text, { inputs: capability.inputs, inputValues: context.inputValues, redactor: options.redactor });
      if (leaks.length > 0) return { ok: false, failure: 'SensitiveLiteral', detail: `The artifact was not written. It carries ${leaks.join(', ')}.` };

      // An exclusive create, so two writers cannot both believe they wrote a version. A
      // version that exists is left alone unless the bytes are identical.
      const path = pathFor(capability.id, capability.version);
      await mkdir(options.directory, { recursive: true });
      try {
        await writeFile(path, text, { flag: 'wx' });
      } catch (error) {
        if (codeOf(error) !== 'EEXIST') throw error;
        if ((await readFile(path, 'utf8')) !== text) {
          return { ok: false, failure: 'VersionExists', detail: `${capability.id}@${capability.version} already exists with different content. A change is a new version.` };
        }
      }
      await writeSidecars(path, capability);
      return { ok: true, path };
    },
  };
}

// Written beside the artifact, and rewritten whenever the artifact is, because a sheet that
// describes a version other than the one next to it is worse than no sheet. Neither is
// canonical, so neither is exclusive create.
async function writeSidecars(path: string, capability: Capability): Promise<void> {
  await writeFile(path.replace(/\.json$/, '.md'), reviewSheet(capability), 'utf8');
  await writeFile(path.replace(/\.json$/, '.tool.json'), `${JSON.stringify(toolFor(capability), null, 2)}
`, 'utf8');
}

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
}

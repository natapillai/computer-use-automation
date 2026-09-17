import type { Capability } from './schema.js';

// A structural diff of two versions of a capability, written into the review evidence as
// artifact.diff.json. Paths are dotted and arrays are indexed, so a reviewer reads what changed
// between 1.0.0 and 1.1.0 without opening either file.

export interface DiffEntry {
  readonly path: string;
  readonly kind: 'added' | 'removed' | 'changed';
  readonly before?: unknown;
  readonly after?: unknown;
}

export function capabilityDiff(before: Capability, after: Capability): readonly DiffEntry[] {
  const entries: DiffEntry[] = [];
  compare('', before, after, entries);
  return entries;
}

function compare(path: string, before: unknown, after: unknown, entries: DiffEntry[]): void {
  if (before === undefined && after === undefined) return;
  if (before === undefined) {
    entries.push({ path, kind: 'added', after });
    return;
  }
  if (after === undefined) {
    entries.push({ path, kind: 'removed', before });
    return;
  }
  if (isBranch(before) && isBranch(after) && Array.isArray(before) === Array.isArray(after)) {
    for (const key of keysOf(before, after)) {
      compare(path === '' ? key : `${path}.${key}`, Reflect.get(before, key), Reflect.get(after, key), entries);
    }
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) entries.push({ path, kind: 'changed', before, after });
}

function isBranch(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function keysOf(before: object, after: object): string[] {
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => String(index));
  }
  const keys = Object.keys(before);
  for (const key of Object.keys(after)) if (!keys.includes(key)) keys.push(key);
  return keys;
}

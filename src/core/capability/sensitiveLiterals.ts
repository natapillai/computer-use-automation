import type { z } from 'zod';
import type { Redactor } from '../redaction/redactor.js';
import type { InputValue } from './inputs.js';
import type { Sensitivity } from './schema.js';

// The rule that an artifact carries no member data, as one pure check. The generalizer runs
// it before it returns a draft, and the capability store runs it again before a byte is
// written, so the enforcement never depends on the caller. A finding names an input or a
// pattern and never the value.

export interface LiteralScanContext {
  readonly inputs: readonly { readonly name: string; readonly sensitivity: z.output<typeof Sensitivity> }[];
  readonly inputValues: Readonly<Record<string, InputValue>>;
  readonly redactor: Redactor;
}

export function findSensitiveLiterals(text: string, context: LiteralScanContext): readonly string[] {
  const found: string[] = [];

  for (const spec of context.inputs) {
    if (spec.sensitivity !== 'pii' && spec.sensitivity !== 'secret') continue;
    const value = context.inputValues[spec.name];
    if (value === undefined || typeof value === 'boolean') continue;
    const literal = String(value);
    if (literal.trim() !== '' && wholeTokenPattern(literal).test(text)) found.push(`input ${spec.name}`);
  }

  const patterns = new Set<string>();
  context.redactor.text(text, { known: [], onMatch: (name) => patterns.add(name) });
  for (const name of [...patterns].sort()) found.push(`pattern ${name}`);

  return found;
}

// A value as a whole token, so member 10001 is found in "link 10001" and not inside 100012.
export function wholeTokenPattern(value: string): RegExp {
  return new RegExp(`(?<!\\w)${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'g');
}

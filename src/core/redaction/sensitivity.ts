import type { z } from 'zod';
import type { Capability, Sensitivity as SensitivitySchema } from '../capability/schema.js';
import { scanTemplate } from '../capability/template.js';
import type { TypedValue } from '../outcome/result.js';
import type { KnownValue, RedactionContext } from './redactor.js';

export type Sensitivity = z.output<typeof SensitivitySchema>;

const RANK: Readonly<Record<Sensitivity, number>> = { public: 0, internal: 1, pii: 2, secret: 3 };

export function higherSensitivity(a: Sensitivity, b: Sensitivity): Sensitivity {
  return RANK[b] > RANK[a] ? b : a;
}

// Sensitivity only ever rises. An output is at least what it declares, at least pii when
// it is money, and at least as sensitive as any input typed into the element it reads.
// Getting this wrong fails silently, which is why it is a pure function with tests.
export function outputSensitivities(capability: Capability): Readonly<Record<string, Sensitivity>> {
  const inputs = new Map(capability.inputs.map((input) => [input.name, input.sensitivity]));

  return Object.fromEntries(
    capability.outputs.map((output) => {
      let level: Sensitivity = output.sensitivity;
      if (output.type === 'money') level = higherSensitivity(level, 'pii');

      const target = JSON.stringify(output.source.target);
      for (const step of capability.steps) {
        if (step.target === undefined || step.value === undefined || JSON.stringify(step.target) !== target) continue;
        for (const reference of scanTemplate(step.value).references) {
          const fed = reference.scope === 'inputs' ? inputs.get(reference.name) : undefined;
          if (fed !== undefined) level = higherSensitivity(level, fed);
        }
      }
      return [output.name, level];
    }),
  );
}

// The provenance half of redaction for one run. Sensitive inputs become their template
// and sensitive outputs a marker naming their level. Public values are left alone.
export function redactionContextFor(
  capability: Capability,
  inputs: Readonly<Record<string, string | number | boolean>>,
  outputs: Readonly<Record<string, TypedValue>>,
): RedactionContext {
  const known: KnownValue[] = [];

  for (const spec of capability.inputs) {
    const value = inputs[spec.name];
    if (value !== undefined && isSensitive(spec.sensitivity)) known.push({ value: String(value), replacement: `{{inputs.${spec.name}}}` });
  }

  const levels = outputSensitivities(capability);
  for (const spec of capability.outputs) {
    const value = outputs[spec.name];
    const level = levels[spec.name];
    const text = value === undefined ? null : textOf(value);
    if (text !== null && level !== undefined && isSensitive(level)) known.push({ value: text, replacement: `[redacted:${level}]` });
  }

  return { known };
}

function isSensitive(level: Sensitivity): boolean {
  return RANK[level] >= RANK.pii;
}

function textOf(value: TypedValue): string | null {
  switch (value.type) {
    case 'money':
      return value.raw;
    case 'string':
    case 'date':
      return value.value;
    case 'number':
      return String(value.value);
    case 'boolean':
      return null;
  }
}

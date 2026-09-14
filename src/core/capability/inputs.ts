import type { z } from 'zod';
import type { ParamSpec as ParamSpecSchema } from './schema.js';

type ParamSpec = z.output<typeof ParamSpecSchema>;

export type InputValue = string | number | boolean;

export interface InputProblem {
  readonly input: string;
  readonly message: string;
}

export type InputValidation =
  | { readonly ok: true; readonly values: Readonly<Record<string, InputValue>>; readonly inputNames: readonly string[] }
  | { readonly ok: false; readonly failure: 'InputValidation'; readonly problems: readonly InputProblem[] };

type Checked = { readonly ok: true; readonly value: InputValue } | { readonly ok: false; readonly message: string };

// Runs before any surface opens. Rejecting a malformed member ID here costs
// milliseconds and keeps garbage out of the target system. No message ever echoes a
// supplied value, because an input may be a member ID.
export function validateInputs(
  specs: readonly ParamSpec[],
  supplied: Readonly<Record<string, unknown>>,
): InputValidation {
  const problems: InputProblem[] = [];
  const values: Record<string, InputValue> = {};

  for (const spec of specs) {
    const raw = Object.hasOwn(supplied, spec.name) ? supplied[spec.name] : undefined;
    if (raw === undefined) {
      if (spec.required) problems.push({ input: spec.name, message: `${spec.name} is required.` });
      continue;
    }
    const checked = check(spec, raw);
    if (checked.ok) {
      values[spec.name] = checked.value;
    } else {
      problems.push({ input: spec.name, message: checked.message });
    }
  }

  const declared = new Set(specs.map((spec) => spec.name));
  for (const name of Object.keys(supplied)) {
    if (!declared.has(name)) problems.push({ input: name, message: `${name} is not a declared input.` });
  }

  if (problems.length > 0) {
    return { ok: false, failure: 'InputValidation', problems };
  }
  return { ok: true, values, inputNames: Object.keys(values).sort() };
}

function check(spec: ParamSpec, raw: unknown): Checked {
  const { name, constraints } = spec;
  const fail = (message: string): Checked => ({ ok: false, message });

  switch (spec.type) {
    case 'string':
    case 'date': {
      if (typeof raw !== 'string') return fail(`${name} must be a string.`);
      if (spec.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(`${name} must be a date written as YYYY-MM-DD.`);
      if (constraints?.minLength !== undefined && raw.length < constraints.minLength) {
        return fail(`${name} must be at least ${constraints.minLength} characters.`);
      }
      if (constraints?.maxLength !== undefined && raw.length > constraints.maxLength) {
        return fail(`${name} must be at most ${constraints.maxLength} characters.`);
      }
      if (constraints?.pattern !== undefined && !new RegExp(constraints.pattern).test(raw)) {
        return fail(`${name} does not match its declared pattern.`);
      }
      return { ok: true, value: raw };
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail(`${name} must be a number.`);
      if (constraints?.min !== undefined && raw < constraints.min) return fail(`${name} must be at least ${constraints.min}.`);
      if (constraints?.max !== undefined && raw > constraints.max) return fail(`${name} must be at most ${constraints.max}.`);
      return { ok: true, value: raw };
    }
    case 'boolean':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : fail(`${name} must be true or false.`);
    case 'enum': {
      const allowed = spec.enumValues ?? [];
      return typeof raw === 'string' && allowed.includes(raw)
        ? { ok: true, value: raw }
        : fail(`${name} must be one of ${allowed.join(', ')}.`);
    }
  }
}

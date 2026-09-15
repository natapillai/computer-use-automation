import type { InputValue } from '../capability/inputs.js';
import type { Capability } from '../capability/schema.js';
import type { ReplayResult, TypedValue } from '../outcome/result.js';
import type { Redactor } from './redactor.js';
import { higherSensitivity, outputSensitivities, redactionContextFor, type Sensitivity } from './sensitivity.js';

// The persisted projection of a replay result, see docs/SAFETY.md section 4. A pii or secret
// value is replaced whole, because the redactor works on text and 425075 minor units is the
// balance whether or not its raw text was hidden. A value nothing declared is treated as pii.
// The rest then passes through the redactor with the run's provenance, so a supplied member
// id in failure text is written as its template.

interface HiddenValue {
  readonly type: TypedValue['type'];
  readonly redacted: string;
}

type Persisted = Readonly<Record<string, TypedValue | HiddenValue>>;

export function persistedResult(result: ReplayResult, capability: Capability, supplied: Readonly<Record<string, InputValue>>, redactor: Redactor): unknown {
  const levels = new Map<string, Sensitivity>(Object.entries(outputSensitivities(capability)));
  for (const outcome of capability.outcomes) {
    for (const spec of outcome.data ?? []) {
      if (!levels.has(spec.name)) levels.set(spec.name, spec.type === 'money' ? higherSensitivity(spec.sensitivity, 'pii') : spec.sensitivity);
    }
  }

  const hide = (values: Readonly<Record<string, TypedValue>>): Persisted =>
    Object.fromEntries(
      Object.entries(values).map(([name, value]) => {
        const level = levels.get(name) ?? 'pii';
        return [name, level === 'pii' || level === 'secret' ? { type: value.type, redacted: `[redacted:${level}]` } : value];
      }),
    );

  let shaped: unknown = result;
  let seen: Readonly<Record<string, TypedValue>> = {};
  if (result.status === 'success') {
    shaped = { ...result, outputs: hide(result.outputs) };
    seen = result.outputs;
  } else if (result.status === 'business_outcome') {
    const { data } = result.outcome;
    shaped = {
      ...result,
      outcome: { ...result.outcome, ...(data === undefined ? {} : { data: hide(data) }) },
      ...(result.partialOutputs === undefined ? {} : { partialOutputs: hide(result.partialOutputs) }),
    };
    seen = { ...(result.partialOutputs ?? {}), ...(data ?? {}) };
  }

  return redactor.object(shaped, redactionContextFor(capability, supplied, seen));
}

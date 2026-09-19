import { z } from 'zod';
import { Capability } from './schema.js';

// The spec as the schema infers it, so this file never restates a field the schema owns.
type ParamSpec = Capability['inputs'][number];

// What a capability looks like to the two audiences that are not the executor. A calling agent
// needs a contract it can invoke against, and a person needs enough to decide whether to
// approve it. Both are generated from the artifact, because a hand written copy of a schema is
// a second source of truth and it drifts from the first one the week after it is written.
//
// Neither carries a value. An artifact holds input specs and never inputs, and these two are
// read and passed around more freely than the artifact is.

// The artifact contract itself, straight from the Zod schema replay validates against.
export function artifactJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(Capability, { io: 'input' }) as Record<string, unknown>;
}

export interface CapabilityTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, Record<string, unknown>>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

const JSON_TYPES: Readonly<Record<ParamSpec['type'], string>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  // A date arrives as text, because JSON has no date and an agent should not have to guess a
  // serialisation. The constraint says which text.
  date: 'string',
  enum: 'string',
};

function propertyFor(spec: ParamSpec): Record<string, unknown> {
  const constraints = spec.constraints;
  return {
    type: JSON_TYPES[spec.type],
    description: spec.description,
    ...(spec.type === 'enum' && spec.enumValues !== undefined ? { enum: [...spec.enumValues] } : {}),
    ...(spec.type === 'date' ? { format: 'date' } : {}),
    ...(constraints?.pattern === undefined ? {} : { pattern: constraints.pattern }),
    ...(constraints?.minLength === undefined ? {} : { minLength: constraints.minLength }),
    ...(constraints?.maxLength === undefined ? {} : { maxLength: constraints.maxLength }),
    ...(constraints?.min === undefined ? {} : { minimum: constraints.min }),
    ...(constraints?.max === undefined ? {} : { maximum: constraints.max }),
  };
}

// The tool definition an agent invokes the capability through. The constraints come along,
// because a caller that can get the input right first time is one fewer failed run.
export function toolFor(capability: Capability): CapabilityTool {
  return {
    name: capability.id.split('.').join('_'),
    description: `${capability.description} Returns ${capability.outputs.map((output) => output.name).join(', ') || 'no outputs'}.`,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(capability.inputs.map((spec) => [spec.name, propertyFor(spec)])),
      // An optional input stays in the schema and out of required, because dropping it would
      // hide a thing the caller is allowed to send.
      required: capability.inputs.filter((spec) => spec.required).map((spec) => spec.name),
      additionalProperties: false,
    },
  };
}

// What a reviewer reads before approving. Markdown, because it is pasted into a ticket as often
// as it is read in a terminal.
export function reviewSheet(capability: Capability): string {
  const lines: string[] = [
    `# ${capability.name}`,
    '',
    `${capability.id} version ${capability.version}, ${capability.lifecycle.status}.`,
    '',
    capability.description,
    '',
    '## What it does',
    '',
    ...capability.steps.map((step) => `${step.index + 1}. ${step.intent}${step.effect === 'write' ? ' (writes)' : ''}`),
    '',
    '## Inputs',
    '',
    ...capability.inputs.map((spec) => `* ${spec.name}, ${spec.type}, ${spec.required ? 'required' : 'optional'}, ${spec.sensitivity}. ${spec.description}`),
    '',
    '## Outputs',
    '',
    ...(capability.outputs.length === 0 ? ['* none'] : capability.outputs.map((output) => `* ${output.name}, ${output.type}, ${output.sensitivity}. ${output.description}`)),
    '',
    '## Declared outcomes',
    '',
    ...(capability.outcomes.length === 0
      ? ['* none, so any state this capability does not expect reports as a failure']
      : capability.outcomes.map((outcome) => `* ${outcome.code}${outcome.terminal ? ', terminal' : ''}. ${outcome.description}`)),
    '',
    '## What approving it allows',
    '',
    `* Highest effect any step may have: ${capability.policy.maxEffect}.`,
    `* May run unattended once approved: ${capability.policy.allowUnattendedReplay ? 'yes' : 'no'}.`,
    `* Bounded at ${capability.policy.maxTotalDurationMs}ms in total and ${capability.policy.maxStepDurationMs}ms per step.`,
    '',
    `Discovered by ${capability.provenance.model ?? 'a person'} on run ${capability.provenance.discoveryRunId}.`,
    '',
  ];
  return lines.join('\n');
}

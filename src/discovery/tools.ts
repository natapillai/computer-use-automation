import type Anthropic from '@anthropic-ai/sdk';

// The whole tool surface a model gets, per ADR 0013. Refs from the latest observation and the
// names of declared inputs, never a selector, a coordinate or text the model wrote to type,
// and never waitFor or assert, because waits and checks are inferred from observed state.
// Names and input schemas match the S2-T01 recording. Descriptions may change freely.
export const DISCOVERY_TOOLS = ['click', 'fill', 'select', 'press', 'navigate', 'extract', 'escalate', 'done'] as const;

export interface ToolOptions {
  // Whether the request permits this run to change state. A run that may not write is never
  // offered the submits flag at all, so the read only tool set stays byte identical to the
  // S2-T01 recording and a model cannot declare a write it was not allowed to attempt.
  readonly writes?: boolean;
}

export function toolsFor(inputNames: readonly string[], options: ToolOptions = {}): Anthropic.Tool[] {
  const ref = { type: 'string', description: 'A ref from the latest observation, such as f3e13.' };
  const input = { type: 'string', enum: [...inputNames], description: 'The name of an input. Its value is typed for you.' };
  // Declaring the write is the model's job, not a bypass. The flag widens nothing on its own.
  // It tells policy that this action is expected to change state, so the action is confirmed by
  // a person before it runs. An undeclared write is refused at the network guard instead.
  const submits = options.writes === true
    ? { submits: { type: 'boolean', description: 'True when this action submits a change, such as a save or an open. A person confirms it before it runs.' } }
    : {};

  const tool = (name: (typeof DISCOVERY_TOOLS)[number], description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Tool => ({
    name,
    description,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
  });

  return [
    tool('click', 'Click the element with this ref.', { ref, ...submits }, ['ref']),
    tool('fill', 'Type the value of a named input into the field with this ref.', { ref, input }, ['ref', 'input']),
    tool('select', 'Choose the option named by an input in the list with this ref.', { ref, input }, ['ref', 'input']),
    tool('press', 'Press a key, such as Enter, on the element with this ref.', { ref, key: { type: 'string' }, ...submits }, ['ref', 'key']),
    tool(
      'navigate',
      'Load a path in a frame. The path may contain {{inputs.name}}. An empty framePath is the top document.',
      { path: { type: 'string' }, framePath: { type: 'array', items: { type: 'string' } } },
      ['path', 'framePath'],
    ),
    tool('extract', 'Record the text of the element with this ref as a named output. You will not see the value.', { ref, output: { type: 'string' } }, ['ref', 'output']),
    tool('escalate', 'Stop and ask a person for help, saying why.', { reason: { type: 'string' } }, ['reason']),
    tool('done', 'Finish, once the goal is complete.', {}, []),
  ];
}

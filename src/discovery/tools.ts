import type Anthropic from '@anthropic-ai/sdk';

// The whole tool surface a model gets, per ADR 0013. Refs from the latest observation and the
// names of declared inputs, never a selector, a coordinate or text the model wrote to type,
// and never waitFor or assert, because waits and checks are inferred from observed state.
// Names and input schemas match the S2-T01 recording. Descriptions may change freely.
export const DISCOVERY_TOOLS = ['click', 'fill', 'select', 'press', 'navigate', 'extract', 'escalate', 'done'] as const;

export function toolsFor(inputNames: readonly string[]): Anthropic.Tool[] {
  const ref = { type: 'string', description: 'A ref from the latest observation, such as f3e13.' };
  const input = { type: 'string', enum: [...inputNames], description: 'The name of an input. Its value is typed for you.' };
  const tool = (name: (typeof DISCOVERY_TOOLS)[number], description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Tool => ({
    name,
    description,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
  });

  return [
    tool('click', 'Click the element with this ref.', { ref }, ['ref']),
    tool('fill', 'Type the value of a named input into the field with this ref.', { ref, input }, ['ref', 'input']),
    tool('select', 'Choose the option named by an input in the list with this ref.', { ref, input }, ['ref', 'input']),
    tool('press', 'Press a key, such as Enter, on the element with this ref.', { ref, key: { type: 'string' } }, ['ref', 'key']),
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

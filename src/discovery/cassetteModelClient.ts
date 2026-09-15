import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ModelClient } from './modelClient.js';

// Replays a recorded model transcript, per ADR 0017. Exchange N answers the Nth call. Each
// call must show the model the same tools, by name and input schema, and the same
// observation, by hash, as the recording did. Tool descriptions and the system prompt may
// change freely. Any other difference fails loudly with a diff instead of replaying the
// wrong turn.

function isMessage(value: unknown): value is Anthropic.Message {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'type') === 'message' && Reflect.get(value, 'role') === 'assistant' && Array.isArray(Reflect.get(value, 'content'));
}

function isTool(value: unknown): value is Anthropic.Tool {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'name') === 'string' && typeof Reflect.get(value, 'input_schema') === 'object';
}

export const Cassette = z.object({
  recordedAt: z.string().min(1),
  source: z.string().min(1),
  runId: z.string().min(1),
  model: z.string().min(1),
  system: z.string(),
  goal: z.string(),
  inputNames: z.array(z.string()),
  tools: z.array(z.custom<Anthropic.Tool>(isTool, 'must be a tool definition')).min(1),
  exchanges: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        observationHash: z.string().min(1),
        observationText: z.string(),
        response: z.custom<Anthropic.Message>(isMessage, 'must be an assistant message'),
      }),
    )
    .min(1),
});

export type CassetteFile = z.output<typeof Cassette>;

export class CassetteMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CassetteMismatch';
  }
}

export function createCassetteModelClient(cassette: CassetteFile): ModelClient {
  const recordedTools = signaturesOf(cassette.tools);
  let calls = 0;

  return {
    next: async (request) => {
      const index = calls;
      calls += 1;
      const exchange = cassette.exchanges[index];
      if (exchange === undefined) {
        throw new CassetteMismatch(`The loop asked for exchange ${index}, and the cassette recorded ${cassette.exchanges.length} exchanges.`);
      }

      const toolDifference = compareTools(recordedTools, signaturesOf(toolsOf(request.params.tools)));
      if (toolDifference !== null) {
        throw new CassetteMismatch(`The tool set at exchange ${index} differs from the recording. ${toolDifference} Re record the cassette with a live run.`);
      }

      if (request.observationHash !== exchange.observationHash) {
        const diff = request.observationText === undefined ? '' : `\n${lineDiff(exchange.observationText, request.observationText)}`;
        throw new CassetteMismatch(
          `The observation at exchange ${index} differs from the recording, hash ${request.observationHash} instead of ${exchange.observationHash}. What the model is shown has changed.${diff}`,
        );
      }

      return { ok: true, response: exchange.response };
    },
  };
}

// Recorded lines not shown now start with a minus, lines shown now and not recorded start
// with a plus. Indentation is dropped so the diff reads as content.
export function lineDiff(recorded: string, current: string): string {
  const before = recorded.split('\n').map((line) => line.trim());
  const after = current.split('\n').map((line) => line.trim());
  const removed = before.filter((line) => !after.includes(line)).map((line) => `- ${line}`);
  const added = after.filter((line) => !before.includes(line)).map((line) => `+ ${line}`);
  return [...removed, ...added].join('\n');
}

function toolsOf(tools: Anthropic.MessageCreateParamsNonStreaming['tools']): readonly Anthropic.Tool[] {
  return (tools ?? []).filter(isTool);
}

function signaturesOf(tools: readonly Anthropic.Tool[]): ReadonlyMap<string, string> {
  return new Map(tools.map((tool) => [tool.name, canonical(tool.input_schema)]));
}

function compareTools(recorded: ReadonlyMap<string, string>, current: ReadonlyMap<string, string>): string | null {
  const missing = [...recorded.keys()].filter((name) => !current.has(name));
  const extra = [...current.keys()].filter((name) => !recorded.has(name));
  const reshaped = [...recorded.keys()].filter((name) => current.has(name) && current.get(name) !== recorded.get(name));
  const problems = [
    ...(missing.length > 0 ? [`Missing ${missing.join(', ')}.`] : []),
    ...(extra.length > 0 ? [`Not recorded ${extra.join(', ')}.`] : []),
    ...(reshaped.length > 0 ? [`Input schema changed for ${reshaped.join(', ')}.`] : []),
  ];
  return problems.length === 0 ? null : problems.join(' ');
}

// JSON with object keys sorted at every level, so key order never reads as a change.
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(sortKeys);
  }
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]: [string, unknown]) => [key, sortKeys(item)]),
  );
}

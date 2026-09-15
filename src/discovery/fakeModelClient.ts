import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelRequest } from './modelClient.js';

// A scripted model for testing the loop's control flow, see docs/TESTING.md section 3.
// Deterministic, instant, free. A script that runs out fails loudly, because a loop that
// asks for more turns than a test planned is a finding, not a default.

export type FakeTurn = { readonly respond: Anthropic.Message } | { readonly fail: string };

export interface FakeModelClient extends ModelClient {
  readonly requests: readonly ModelRequest[];
}

export function createFakeModelClient(script: readonly FakeTurn[]): FakeModelClient {
  const requests: ModelRequest[] = [];

  return {
    get requests() {
      return [...requests];
    },
    next: async (request) => {
      const turn = script[requests.length];
      requests.push(request);
      if (turn === undefined) {
        throw new Error(`The fake model was asked for turn ${requests.length} of a script of ${script.length} turn(s).`);
      }
      return 'respond' in turn ? { ok: true, response: turn.respond } : { ok: false, failure: 'ModelCallFailed', detail: turn.fail };
    },
  };
}

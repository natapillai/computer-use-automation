import type Anthropic from '@anthropic-ai/sdk';
import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionBroker } from '../../src/control/sessionBroker.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { runDiscovery, type DiscoveryOptions, type DiscoveryResult } from '../../src/discovery/agentLoop.js';
import type { ModelClient } from '../../src/discovery/modelClient.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// The discovery write path against the real application, S5-T06. A model declares a write with
// the submits flag, which raises the step's effect and sends it to a person before it reaches
// the surface. The flag is an affordance and never a bypass, so the case that matters most here
// is the one where the model omits it. That write is refused by the network guard rather than
// performed, because the step it ran under declared a read and the app profile calls the
// request a write. See docs/SAFETY.md section 1 and ADR 0014.

const GOAL =
  'open a {{inputs.accountType}} sub account for the member whose member ID is {{inputs.memberId}}, with an opening amount of {{inputs.openingAmount}}.';

const INPUTS = { memberId: '10001', accountType: 'Holiday Club', openingAmount: '250.00' };

// One scripted decision, chosen from the observation the loop just built, so nothing in this
// test depends on a ref the driver happens to issue.
type Turn = (text: string) => { readonly name: string; readonly input: Record<string, unknown> };

function refFor(text: string, needle: string): string {
  const line = text.split('\n').find((candidate) => candidate.includes(needle));
  const ref = line === undefined ? undefined : /\[([^\]]+)\]/.exec(line)?.[1];
  if (ref === undefined) throw new Error(`No observation line contains ${needle}.`);
  return ref;
}

interface ScriptedModel extends ModelClient {
  // What the loop sent back after each decision, which is where a refusal shows up.
  readonly results: readonly string[];
}

function scriptedModel(turns: readonly Turn[]): ScriptedModel {
  const results: string[] = [];
  let index = 0;

  return {
    get results() {
      return [...results];
    },
    next: async (request) => {
      const last = request.params.messages.at(-1);
      const blocks = Array.isArray(last?.content) ? last.content : [];
      for (const block of blocks) if (block.type === 'tool_result') results.push(typeof block.content === 'string' ? block.content : '');

      const turn = turns[index];
      index += 1;
      if (turn === undefined) throw new Error(`The scripted model was asked for turn ${index} of ${turns.length}.`);
      const decision = turn(request.observationText ?? '');
      return {
        ok: true,
        response: {
          id: `msg_${index}`,
          type: 'message',
          role: 'assistant',
          model: 'scripted',
          content: [{ type: 'tool_use', id: `toolu_${index}`, name: decision.name, input: decision.input }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message,
      };
    },
  };
}

describe('discovery declaring a write', { timeout: 120_000 }, () => {
  let server: Server;
  let base: string;
  let browser: Browser;
  let profile: AppProfile;

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'discovery-write' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    profile = await meridianProfile();
  }, 60_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // The same run every time, with only the flag on the last click changing.
  function script(submits: boolean): Turn[] {
    return [
      () => ({ name: 'navigate', input: { path: '/member/{{inputs.memberId}}/subaccount', framePath: ['content'] } }),
      // The control, not the label cell beside it. The model sees both and picks the one it
      // can act on, so the script does the same rather than matching the first line that reads
      // Account Type.
      (text) => ({ name: 'select', input: { ref: refFor(text, 'combobox'), input: 'accountType' } }),
      (text) => ({ name: 'fill', input: { ref: refFor(text, 'textbox'), input: 'openingAmount' } }),
      (text) => ({ name: 'click', input: { ref: refFor(text, 'Open Account'), ...(submits ? { submits: true } : {}) } }),
      () => ({ name: 'done', input: {} }),
    ];
  }

  async function discover(options: {
    readonly submits: boolean;
    readonly escalation?: (issue: () => { sessionId: string; holder: 'automation' | 'human'; value: string }) => NonNullable<DiscoveryOptions['escalation']>;
  }): Promise<{ result: DiscoveryResult; model: ScriptedModel; refused: readonly string[]; submissions: unknown }> {
    await fetch(`${base}/__control__/reset`);
    const runId = 'run_000001';
    const grants = createGrantLedger();
    const broker = createSessionBroker({
      browser,
      profile,
      allowlist: allowlistFor(base),
      baseUrl: base,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
      ids: createSequentialIds(),
    });
    const leased = await broker.lease({ runId, policy: { phase: 'discovery', capabilityStatus: null, allowUnattendedReplay: false, grants } });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);

    const model = scriptedModel(script(options.submits));
    try {
      const result = await runDiscovery({
        surface: leased.lease.surface,
        control: leased.lease.tokens.issue('automation'),
        model,
        modelId: 'scripted',
        clock: systemClock,
        goal: GOAL,
        inputs: INPUTS,
        profile,
        redactor: createRedactor({ neverPersist: ['password'], redactPatterns: [] }),
        budgets: { maxModelCalls: 12, maxActions: 12, maxDurationMs: 90_000 },
        entryPath: '/servicing',
        runId,
        grants,
        allowWrites: true,
        ...(options.escalation === undefined ? {} : { escalation: options.escalation(() => leased.lease.tokens.issue('automation')) }),
      });
      const state: unknown = await (await fetch(`${base}/__control__/state`)).json();
      return {
        result,
        model,
        refused: leased.lease.refusedRequests(),
        submissions: typeof state === 'object' && state !== null ? Reflect.get(state, 'submissions') : undefined,
      };
    } finally {
      await leased.lease.release();
    }
  }

  it('refuses the write the model never declared, and opens no account', async () => {
    const { model, refused, submissions } = await discover({ submits: false });

    expect(submissions).toEqual([]);
    expect(refused.some((rule) => rule === 'effect')).toBe(true);
    expect(model.results.some((text) => text.includes('network guard refused'))).toBe(true);
  });

  it('stops for a person when the model declares the write, and opens the account once they approve', async () => {
    const raised: string[] = [];
    const { result, submissions } = await discover({
      submits: true,
      escalation: (issue) => ({
        raise: async (input) => {
          raised.push(input.reason);
          return { kind: 'resumed', interventionId: 'int_000001', approved: true, token: issue() };
        },
      }),
    });

    expect(raised).toEqual(['PolicyConfirmation']);
    expect(result.status).toBe('done');
    expect(submissions).toEqual([{ memberId: '10001', accountType: 'Holiday Club', suffix: 'H01', balance: '$250.00' }]);
  });

  it('opens nothing when the person declines, and never asks the surface to submit', async () => {
    const { result, submissions, model } = await discover({
      submits: true,
      escalation: (issue) => ({
        raise: async () => ({ kind: 'resumed', interventionId: 'int_000002', approved: false, token: issue() }),
      }),
    });

    expect(submissions).toEqual([]);
    expect(result.status).toBe('done');
    expect(model.results.some((text) => text.includes('declined'))).toBe(true);
  });
});

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { runReviewCommand } from '../../src/cli/reviewCommand.js';
import { createSessionControl } from '../../src/control/controlPlane.js';
import { createSessionBroker } from '../../src/control/sessionBroker.js';
import { Capability } from '../../src/core/capability/schema.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { createRedactor } from '../../src/core/redaction/redactor.js';
import { createFileCapabilityStore } from '../../src/evidence/capabilityStore.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { handleIntervention } from '../fixtures/mockOperator.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// Reviewing a capability that writes. The probe submits a deliberately invalid opening amount
// to find the message the application answers with, and both the probe and the verification
// stop for a person, because a review of a write is a replay of a write.
//
// This exists because doing it by hand hung, twice, and a hang is not something to diagnose by
// clicking. The two runs are the same command a person runs.

const DRAFT = 'capabilities/member.openSubAccount@1.0.0.json';
const DECISION = 'requests/member.openSubAccount.AMOUNT_BELOW_MINIMUM.review.json';
const PROBE = '{"memberId":"10001","accountType":"Holiday Club","openingAmount":"5.00"}';
const credentials = { username: 'operator', password: 'meridian-fixture' };

describe('reviewing a capability that writes', { timeout: 180_000 }, () => {
  let server: Server;
  let base = '';
  let browser: Browser;
  let profile: AppProfile;
  let root = '';

  beforeAll(async () => {
    profile = await meridianProfile();
    const app = createTargetApp({ ...credentials, testMode: true, idSeed: 'review-write' });
    server = await new Promise<Server>((listening) => {
      const bound = app.listen(0, '127.0.0.1', () => listening(bound));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    root = await mkdtemp(join(tmpdir(), 'review-write-'));
  }, 60_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((closed) => server.close(() => closed()));
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  it('declares the field error as a business outcome, approving each write the probe needs', async () => {
    await fetch(`${base}/__control__/reset`);
    const directory = join(root, 'capabilities');
    const redactor = createRedactor({ neverPersist: ['password'], redactPatterns: [] });
    const store = createFileCapabilityStore({ directory, redactor });
    const copied = await store.write(JSON.parse(await readFile(DRAFT, 'utf8')), { inputValues: {} });
    if (!copied.ok) throw new Error(`The draft was not copied. ${copied.detail}`);

    const out: string[] = [];
    const err: string[] = [];
    let working: Promise<unknown> = Promise.resolve();

    const code = await runReviewCommand({
      argv: ['--capability', copied.path, '--decision', DECISION, '--evidence', join(root, 'evidence')],
      readStdin: async () => PROBE,
      readText: (path) => readFile(path, 'utf8'),
      stdout: (text) => out.push(text),
      stderr: (text) => {
        err.push(text);
        const url = /(http:\/\/\S+\/interventions\/\S+)/.exec(text)?.[1];
        if (url === undefined) return;
        working = working.then(() => handleIntervention(url, { finish: { release: true, approve: true } }));
      },
      makeStore: (where) => createFileCapabilityStore({ directory: where, redactor }),
      loadProfile: async () => ({ ok: true, profile }),
      lease: async ({ runId }) => {
        const broker = createSessionBroker({
          browser,
          profile,
          allowlist: allowlistFor(base),
          baseUrl: base,
          login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', ...credentials },
          ids: createSequentialIds(),
        });
        const grants = createGrantLedger();
        const leased = await broker.lease({ runId, policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants } });
        if (!leased.ok) return { ok: false, detail: leased.detail };
        const session = createSessionControl({ sessionId: leased.lease.sessionId, ids: createSequentialIds(), clock: systemClock, runId, tokens: leased.lease.tokens });
        const control = session.apply('start').token;
        if (control === null) return { ok: false, detail: 'The session issued no token to start with.' };
        return { ok: true, lease: { surface: leased.lease.surface, control, session, grants, human: leased.lease.human, release: () => leased.lease.release() } };
      },
      redactor,
      clock: systemClock,
      ids: createSequentialIds(),
      target: { baseUrl: base },
      environment: { driver: 'web', driverVersion: '1.0.0' },
      console: { port: 0, claimTimeoutMs: 60_000 },
    });
    await working;

    expect(code, err.join('')).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({
      status: 'declared',
      code: 'AMOUNT_BELOW_MINIMUM',
      verification: { status: 'business_outcome', code: 'AMOUNT_BELOW_MINIMUM' },
    });

    // The detector is derived from the element on the screen the probe stopped on, like every
    // other locator, so nobody hand wrote a selector for it.
    const reviewed = Capability.parse(JSON.parse(await readFile(join(directory, 'member.openSubAccount@1.1.0.json'), 'utf8')));
    expect(reviewed.outcomes.map((outcome) => outcome.code)).toEqual(['AMOUNT_BELOW_MINIMUM']);
    expect(reviewed.outcomes[0]?.terminal).toBe(true);

    // The probe and the verification both submitted, and neither opened an account, because
    // the application refused the amount. That is what makes this a business outcome.
    const state: unknown = await (await fetch(`${base}/__control__/state`)).json();
    expect(Reflect.get(state as object, 'submissions')).toEqual([]);
  });
});

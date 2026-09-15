import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTargetApp } from '../../apps/target/src/app.js';
import { createSessionBroker } from '../../src/control/sessionBroker.js';
import { Capability } from '../../src/core/capability/schema.js';
import type { ReplayResult } from '../../src/core/outcome/result.js';
import { createGrantLedger } from '../../src/core/policy/authorize.js';
import type { AppProfile } from '../../src/core/policy/profile.js';
import { replay } from '../../src/replay/executor.js';
import { systemClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { readSavingsBalanceFixture } from '../fixtures/capabilities/readSavingsBalance.js';
import { allowlistFor } from '../fixtures/policy/allowlist.js';
import { meridianProfile } from '../fixtures/profile.js';

// The network guard enforces the app profile per step. A request the profile calls a
// write, fired while a step declared as a read is running, must be refused before it
// reaches the server, and the step must fail as PolicyDenied.
describe('the network guard enforcing the app profile per step', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let browser: Browser;
  let profile: AppProfile;

  beforeAll(async () => {
    const app = createTargetApp({ username: 'operator', password: 'meridian-fixture', testMode: true, idSeed: 'profile-guard' });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The target app did not bind a TCP port.');
    base = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    profile = await meridianProfile();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function replayWith(withProfile: AppProfile): Promise<{ result: ReplayResult; refused: readonly string[] }> {
    const broker = createSessionBroker({
      browser,
      profile: withProfile,
      allowlist: allowlistFor(base),
      baseUrl: base,
      login: { path: '/auth/login', usernameField: 'username', passwordField: 'password', username: 'operator', password: 'meridian-fixture' },
      ids: createSequentialIds(),
    });
    const leased = await broker.lease({ runId: 'run_000001', policy: { phase: 'replay', capabilityStatus: 'draft', allowUnattendedReplay: false, grants: createGrantLedger() } });
    if (!leased.ok) throw new Error(`The lease failed. ${leased.detail}`);
    try {
      const result = await replay(Capability.parse(readSavingsBalanceFixture()), { memberId: '10001' }, {
        surface: leased.lease.surface,
        control: leased.lease.tokens.issue('automation'),
        clock: systemClock,
        runId: 'run_000001',
        profile: withProfile,
      });
      return { result, refused: leased.lease.refusedRequests() };
    } finally {
      await leased.lease.release();
    }
  }

  async function requestsServed(): Promise<unknown> {
    const state: unknown = await (await fetch(`${base}/__control__/state`)).json();
    return typeof state === 'object' && state !== null ? Reflect.get(state, 'requests') : undefined;
  }

  it('refuses the search POST before it lands when the profile calls it a write and the step declares a read', async () => {
    const strict: AppProfile = {
      ...profile,
      routes: profile.routes.map((route) => (route.method === 'POST' && route.path === '/servicing/search' ? { ...route, effect: 'write' } : route)),
    };
    await fetch(`${base}/__control__/reset`);

    const { result, refused } = await replayWith(strict);

    expect(result).toMatchObject({ status: 'failure', failure: { class: 'PolicyDenied', atStepId: 'submitSearch', cause: 'rule effect' } });
    expect(refused).toContain('effect');
    const served = await requestsServed();
    expect(served).toContainEqual({ method: 'GET', path: '/servicing/search' });
    expect(served).not.toContainEqual({ method: 'POST', path: '/servicing/search' });
  });

  it('lets the same replay through with the committed profile and refuses nothing', async () => {
    await fetch(`${base}/__control__/reset`);

    const { result, refused } = await replayWith(profile);

    expect(result.status).toBe('success');
    expect(refused).toEqual([]);
    expect(await requestsServed()).toContainEqual({ method: 'POST', path: '/servicing/search' });
  });
});
